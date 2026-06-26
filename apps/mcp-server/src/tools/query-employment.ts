import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma, StudentEmployment } from '@lp-ai/lib-db';

import { runTool } from '../tool-helpers.js';

// ---------------------------------------------------------------------------
// query_employment — reads student_employment, populated from the Employment
// tab of the V2 Student Information sheet. One row per (student × position).
//
// Three business rules applied here that the raw sheet doesn't encode:
//
// 1. ACTIVE JOBS (end_date is blank → still employed):
//    total_earned in the sheet may be stale or blank. Compute
//      current_earned = weeks_since_start × weekly_hours × hourly_wage
//    using today as the effective end_date. Used wherever total_earned would
//    appear in aggregates. Per-row responses include current_earned alongside
//    a current_earned_is_computed flag.
//
// 2. RATE / HOURS CHANGES: The same job may appear on multiple rows when the
//    student's hourly rate or weekly hours changed mid-employment. Rows with
//    the same (student, employer, jobTitle) are consolidated into a single
//    logical job. Each row covers a date range at one rate so that hours and
//    total pay can be tracked accurately over time. The chain sums earnings
//    across all rows.
//
// 3. PROMOTIONS / DEMOTIONS (exit_code = E3 or E4 with a later same-employer
//    position) collapse into a single continuous job for counting and
//    earnings totals, even when the job title changes. The chain's
//    effective_exit_code is the LAST row's exit_code; intermediate E3/E4s
//    are treated as transitions inside one job. Per-row responses include
//    chain_id and chain_position so callers can see the linkage.
//
// Exit code taxonomy (stored verbatim from the sheet, e.g. "E3 - Internal
// Promotion"):
//   E0     Temporary Employment / Contract Ended
//   E1.1   Resigned — New Job Opportunity
//   E1.2   Resigned — Education Opportunity
//   E1.3   Resigned — Relocation
//   E1.4   Resigned — No Opportunity
//   E2.1   Terminated — Lay Off
//   E2.2   Terminated — Performance
//   E3     Internal Promotion
//   E4     Internal Demotion
//   E5     Unknown Reason
// ---------------------------------------------------------------------------

const NAME = 'query_employment';

const DESCRIPTION =
  'Student employment data — jobs held during/after the program, with earnings, exit codes, and active-job tracking. Active jobs (blank end_date) get a computed current_earned = weeks_since_start × weekly_hours × hourly_wage. Multiple rows with the same (student, employer, jobTitle) but different date ranges (rate/hours changes) are consolidated into one logical job; E3/E4 promotion/demotion exits at the same employer also consolidate across title changes. The chain_id / chain_position fields in listings expose the linkage.';

const inputSchema = {
  query_type: z.enum([
    'by_student',
    'by_employer',
    'by_exit_code',
    'active_during',
    'aggregate',
  ]),
  student_number: z.string().optional(),
  employer_name:  z.string().optional(),
  exit_code:      z.string().optional(),
  start_date:     z.string().optional(),
  end_date:       z.string().optional(),
  group_by: z.enum(['employer', 'exit_code', 'employment_type', 'student']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object' && 'toString' in v) {
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// Returns earned-to-date for a row. For closed jobs (end_date set), the
// sheet's total_earned is treated as authoritative. For open jobs
// (end_date blank), earned is computed from start_date to today using
// weekly_hours × hourly_wage. Returns null only when *both* the sheet
// value is missing AND the computation inputs are insufficient.
function computeEarned(row: StudentEmployment, asOf: Date): { value: number | null; computed: boolean } {
  const sheetValue = num(row.totalEarned);
  if (row.endDate) {
    return { value: sheetValue, computed: false };
  }
  const start = row.startDate ?? null;
  const weeklyHours = num(row.weeklyHours);
  const hourlyWage = num(row.hourlyWage);
  if (!start || weeklyHours == null || hourlyWage == null) {
    return { value: sheetValue, computed: false };
  }
  const msPerWeek = 7 * 24 * 3600 * 1000;
  const weeks = Math.max(0, (asOf.getTime() - start.getTime()) / msPerWeek);
  const computed = Math.round(weeks * weeklyHours * hourlyWage * 100) / 100;
  return { value: computed, computed: true };
}

function effectiveEndDate(row: StudentEmployment, asOf: Date): string {
  return dateIso(row.endDate) ?? asOf.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Chain consolidation: E3/E4 + later same-employer position → one job
// ---------------------------------------------------------------------------

type Chain = {
  chain_id: string;
  rows: StudentEmployment[];
  student_number: string;
  employer_name: string | null;
  first_start_date: string | null;
  effective_end_date: string;
  is_active: boolean;
  effective_exit_code: string | null;
  total_earned: number;
  any_earned_computed: boolean;
  most_recent_hourly_wage: number | null;
  most_recent_weekly_hours: number | null;
  most_recent_employment_type: string | null;
  most_recent_job_title: string | null;
};

function employerKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

function titleKey(title: string | null | undefined): string {
  return (title ?? '').trim().toLowerCase();
}

function buildChains(rows: StudentEmployment[], asOf: Date): Chain[] {
  // Bucket by (student × employer) so chains can only form within the bucket.
  // The bucket-key separator is '|' (NOT a NUL byte — see V0 commit history
  // for why that mattered: NUL made git treat the file as binary).
  const buckets = new Map<string, StudentEmployment[]>();
  for (const r of rows) {
    const k = `${r.studentNumber}|${employerKey(r.employerName)}`;
    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = [];
      buckets.set(k, bucket);
    }
    bucket.push(r);
  }

  const chains: Chain[] = [];
  for (const bucket of buckets.values()) {
    // Sort by start_date ascending; rows with no start_date sink to the end.
    bucket.sort((a, b) => {
      const da = a.startDate ? a.startDate.getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.startDate ? b.startDate.getTime() : Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    let current: StudentEmployment[] = [];
    for (let i = 0; i < bucket.length; i += 1) {
      const r = bucket[i]!;
      current.push(r);

      const hasNext = i + 1 < bucket.length;
      if (!hasNext) {
        chains.push(makeChain(current, asOf));
        current = [];
        continue;
      }

      const next = bucket[i + 1]!;
      // Same job title → same logical job (rate/hours change across date
      // ranges). Always chain these together.
      const sameTitle = titleKey(r.jobTitle) === titleKey(next.jobTitle);

      // E3/E4 promotion/demotion exit → chain across title changes at the
      // same employer. The sheet stores exit codes as full labels
      // ("E3 - Internal Promotion"), so we match by prefix.
      const code = (r.exitCode ?? '').trim().toUpperCase();
      const isPromoExit = /^E3(?:\b|\s|-|$)/.test(code) || /^E4(?:\b|\s|-|$)/.test(code);

      if (!sameTitle && !isPromoExit) {
        // Truly separate job at the same employer — break the chain.
        chains.push(makeChain(current, asOf));
        current = [];
      }
    }
    if (current.length > 0) chains.push(makeChain(current, asOf));
  }
  return chains;
}

function makeChain(rows: StudentEmployment[], asOf: Date): Chain {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  let total = 0;
  let anyComputed = false;
  for (const r of rows) {
    const { value, computed } = computeEarned(r, asOf);
    if (value != null) total += value;
    if (computed) anyComputed = true;
  }
  return {
    chain_id: first.sourceId,
    rows,
    student_number: first.studentNumber,
    employer_name: first.employerName,
    first_start_date: dateIso(first.startDate),
    effective_end_date: effectiveEndDate(last, asOf),
    is_active: !last.endDate,
    effective_exit_code: last.exitCode ?? null,
    total_earned: Math.round(total * 100) / 100,
    any_earned_computed: anyComputed,
    most_recent_hourly_wage: num(last.hourlyWage),
    most_recent_weekly_hours: num(last.weeklyHours),
    most_recent_employment_type: last.employmentType,
    most_recent_job_title: last.jobTitle,
  };
}

function rowChainMap(chains: Chain[]): Map<string, { chain: Chain; position: number }> {
  const map = new Map<string, { chain: Chain; position: number }>();
  for (const c of chains) {
    for (let i = 0; i < c.rows.length; i += 1) {
      map.set(c.rows[i]!.sourceId, { chain: c, position: i + 1 });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeJob(
  e: StudentEmployment,
  asOf: Date,
  chainInfo: { chain: Chain; position: number } | undefined,
): Record<string, unknown> {
  const { value, computed } = computeEarned(e, asOf);
  return {
    source_id:       e.sourceId,
    student_number:  e.studentNumber,
    student_name:    e.studentName,
    employer_name:   e.employerName,
    employment_type: e.employmentType,
    job_title:       e.jobTitle,
    start_date:      dateIso(e.startDate),
    end_date:        dateIso(e.endDate),
    effective_end_date: effectiveEndDate(e, asOf),
    is_active:       !e.endDate,
    hourly_wage:     num(e.hourlyWage),
    weekly_hours:    num(e.weeklyHours),
    sheet_total_earned: num(e.totalEarned),
    current_earned:  value,
    current_earned_is_computed: computed,
    exit_code:       e.exitCode,
    notes:           e.notes,
    chain_id:        chainInfo?.chain.chain_id ?? e.sourceId,
    chain_position:  chainInfo?.position ?? 1,
    chain_size:      chainInfo?.chain.rows.length ?? 1,
    is_chain_head:   (chainInfo?.position ?? 1) === 1,
  };
}

function buildWhere(args: {
  student_number?: string | undefined;
  employer_name?: string | undefined;
  exit_code?: string | undefined;
}): Prisma.StudentEmploymentWhereInput {
  const where: Prisma.StudentEmploymentWhereInput = {};
  if (args.student_number) where.studentNumber = args.student_number;
  if (args.employer_name) where.employerName = { contains: args.employer_name, mode: 'insensitive' };
  if (args.exit_code) where.exitCode = { startsWith: args.exit_code, mode: 'insensitive' };
  return where;
}

const NOTE_RULES =
  'Active jobs (blank end_date in source): current_earned is computed from start_date to today using weekly_hours × hourly_wage. Multiple rows with the same (student, employer, job title) but different date ranges (reflecting rate or hours changes) are consolidated into one logical job. Promotions/demotions (exit_code E3 or E4) also consolidate across title changes at the same employer. chain_id / chain_position annotations identify the linkage in listings.';

// ---------------------------------------------------------------------------
// Aggregation accumulator
// ---------------------------------------------------------------------------

type Acc = {
  student_set: Set<string>;
  chain_count: number;
  total_earned_sum: number;
  weekly_hours_sum: number;
  weekly_hours_n: number;
  hourly_wage_sum: number;
  hourly_wage_n: number;
  active_count: number;
  any_earned_computed: boolean;
};

function newAcc(): Acc {
  return {
    student_set: new Set<string>(),
    chain_count: 0,
    total_earned_sum: 0,
    weekly_hours_sum: 0,
    weekly_hours_n: 0,
    hourly_wage_sum: 0,
    hourly_wage_n: 0,
    active_count: 0,
    any_earned_computed: false,
  };
}

function tally(a: Acc, c: Chain): void {
  a.student_set.add(c.student_number);
  a.chain_count += 1;
  a.total_earned_sum += c.total_earned;
  if (c.most_recent_weekly_hours != null) {
    a.weekly_hours_sum += c.most_recent_weekly_hours;
    a.weekly_hours_n += 1;
  }
  if (c.most_recent_hourly_wage != null) {
    a.hourly_wage_sum += c.most_recent_hourly_wage;
    a.hourly_wage_n += 1;
  }
  if (c.is_active) a.active_count += 1;
  if (c.any_earned_computed) a.any_earned_computed = true;
}

function fmtAcc(a: Acc): Record<string, unknown> {
  return {
    job_count:           a.chain_count,
    active_job_count:    a.active_count,
    student_count:       a.student_set.size,
    total_earned_sum:    Math.round(a.total_earned_sum * 100) / 100,
    avg_weekly_hours:    a.weekly_hours_n > 0 ? Math.round((a.weekly_hours_sum / a.weekly_hours_n) * 100) / 100 : null,
    avg_hourly_wage:     a.hourly_wage_n > 0 ? Math.round((a.hourly_wage_sum / a.hourly_wage_n) * 100) / 100 : null,
    includes_computed_earnings: a.any_earned_computed,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerQueryEmployment(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = String(raw['query_type'] ?? '');
      const args = {
        student_number: typeof raw['student_number'] === 'string' ? raw['student_number'] : undefined,
        employer_name:  typeof raw['employer_name']  === 'string' ? raw['employer_name']  : undefined,
        exit_code:      typeof raw['exit_code']      === 'string' ? raw['exit_code']      : undefined,
        start_date:     typeof raw['start_date']     === 'string' ? raw['start_date']     : undefined,
        end_date:       typeof raw['end_date']       === 'string' ? raw['end_date']       : undefined,
        group_by:       typeof raw['group_by']       === 'string' ? raw['group_by'] as 'employer' | 'exit_code' | 'employment_type' | 'student' : undefined,
        limit:          typeof raw['limit']          === 'number' ? raw['limit']          : 200,
      };

      const asOf = new Date();
      const asOfIso = todayIso();
      const baseWhere = buildWhere(args);

      // ---------- active_during ----------
      if (queryType === 'active_during') {
        if (!args.start_date && !args.end_date) {
          return { error: { code: 'no_records', message: 'active_during requires at least one of start_date or end_date (YYYY-MM-DD).' } };
        }
        const winStart = args.start_date ?? '0001-01-01';
        const winEnd   = args.end_date   ?? '9999-12-31';

        // start_date <= window end AND (end_date or today) >= window start
        const where: Prisma.StudentEmploymentWhereInput = {
          AND: [
            baseWhere,
            {
              OR: [
                { startDate: null },
                { startDate: { lte: new Date(`${winEnd}T00:00:00Z`) } },
              ],
            },
            {
              OR: [
                { endDate: { gte: new Date(`${winStart}T00:00:00Z`) } },
                ...(asOfIso >= winStart ? [{ endDate: null }] : []),
              ],
            },
          ],
        };

        const rows = await prisma.studentEmployment.findMany({
          where,
          orderBy: [{ studentNumber: 'asc' }, { startDate: 'asc' }],
        });

        const chains = buildChains(rows, asOf);
        const rowChain = rowChainMap(chains);

        return {
          query_type: 'active_during',
          filters: args,
          asOf: asOfIso,
          total_rows: rows.length,
          consolidated_job_count: chains.length,
          note: NOTE_RULES,
          jobs: rows.slice(0, args.limit ?? 200).map((r) => serializeJob(r, asOf, rowChain.get(r.sourceId))),
        };
      }

      // ---------- by_student / by_employer / by_exit_code (listing) ----------
      if (queryType === 'by_student' || queryType === 'by_employer' || queryType === 'by_exit_code') {
        const rows = await prisma.studentEmployment.findMany({
          where: baseWhere,
          include: { student: { select: { canonicalName: true } } },
          orderBy: [{ studentNumber: 'asc' }, { startDate: 'asc' }],
        });

        const empRows = rows.map((r) => {
          const { student: _student, ...rest } = r;
          return rest as StudentEmployment;
        });
        const chains = buildChains(empRows, asOf);
        const rowChain = rowChainMap(chains);

        return {
          query_type: queryType,
          filters: args,
          asOf: asOfIso,
          total_rows: rows.length,
          consolidated_job_count: chains.length,
          note: NOTE_RULES,
          jobs: rows.slice(0, args.limit ?? 200).map((r) => {
            const { student, ...rest } = r;
            return {
              ...serializeJob(rest as StudentEmployment, asOf, rowChain.get(r.sourceId)),
              canonical_name: student?.canonicalName ?? null,
            };
          }),
        };
      }

      // ---------- aggregate (works on consolidated chains) ----------
      const allRows = await prisma.studentEmployment.findMany({ where: baseWhere });
      const chains = buildChains(allRows, asOf);

      const groupBy = args.group_by ?? 'exit_code';
      const groups = new Map<string, Acc>();
      const overall = newAcc();
      for (const c of chains) {
        tally(overall, c);
        const k = (() => {
          switch (groupBy) {
            case 'employer':        return c.employer_name ?? '(unknown)';
            case 'exit_code':       return c.effective_exit_code ?? '(active)';
            case 'employment_type': return c.most_recent_employment_type ?? '(unknown)';
            case 'student':         return c.student_number;
          }
        })();
        let g = groups.get(k);
        if (!g) {
          g = newAcc();
          groups.set(k, g);
        }
        tally(g, c);
      }

      const breakdown = [...groups.entries()]
        .map(([group, a]) => ({ group, ...fmtAcc(a) }))
        .sort((a, b) => {
          const av = (a as Record<string, unknown>)['total_earned_sum'];
          const bv = (b as Record<string, unknown>)['total_earned_sum'];
          return (typeof bv === 'number' ? bv : 0) - (typeof av === 'number' ? av : 0);
        });

      return {
        query_type: 'aggregate',
        filters: args,
        group_by: groupBy,
        asOf: asOfIso,
        note: NOTE_RULES,
        overall: fmtAcc(overall),
        breakdown,
      };
    }),
  );
}
