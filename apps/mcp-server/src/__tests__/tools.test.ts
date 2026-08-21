import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, seed } from '@lp-ai/lib-db';

import { McpStdioClient } from './mcp-client.js';

const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

describeLocal('MCP tool handlers (integration)', () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    await seed({ force: true });
    client = new McpStdioClient();
  });

  afterAll(async () => {
    client.close();
    await prisma.$disconnect();
  });

  it('tools/list exposes all 26 tools', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'find_grant_documents',
        'get_entity_brief',
        'get_finance_brief',
        'get_student_info',
        'grant_build_draft',
        'grant_match_question',
        'grant_resize_answer',
        'grant_verify_figure',
        'query_attendance',
        'query_certifications',
        'query_competency',
        'query_donors',
        'query_employment',
        'query_enrollment',
        'query_finances',
        'query_outcomes',
        'query_postsecondary',
        'query_students',
        'search_by_person',
        'search_conversations',
        'search_documents',
        'skill_board_reporting',
        'skill_finance_audit',
        'skill_grant_prospecting',
        'skill_grant_sourcing_evaluation',
        'skill_grant_writing',
      ].sort(),
    );
  });

  it('get_student_info resolves a Slack handle to canonical record', async () => {
    const result = (await client.callTool('get_student_info', {
      student_name: '@maria.g',
    })) as {
      student: {
        canonical_name: string;
        student_number: string;
        current_phase: string;
        known_aliases: Array<{ source: string; alias: string }>;
      };
      entity_resolved: boolean;
      entity_confidence: number;
      match_type: string;
    };
    expect(result.entity_resolved).toBe(true);
    expect(result.match_type).toBe('exact');
    expect(result.entity_confidence).toBe(1);
    expect(result.student.canonical_name).toBe('Maria Garcia');
    expect(result.student.student_number).toBe('LP1042');
    expect(result.student.current_phase).toBe('101');
    const sources = result.student.known_aliases.map((a) => a.source).sort();
    expect(sources).toEqual(['bigquery', 'drive', 'drive', 'slack']);
  });

  it('get_student_info returns entity_not_found for unknown name', async () => {
    const result = (await client.callTool('get_student_info', {
      student_name: 'Nonexistent Person',
    })) as { error?: { code: string } };
    expect(result.error?.code).toBe('entity_not_found');
  });

  it('query_certifications summary returns valid shape', async () => {
    const result = (await client.callTool('query_certifications', {
      query_type: 'summary',
    })) as {
      query_type: string;
      total: number;
      passed: number;
      failed: number;
      pass_rate_pct: number | null;
    };
    expect(result.query_type).toBe('summary');
    expect(typeof result.total).toBe('number');
    expect(typeof result.passed).toBe('number');
    expect(typeof result.failed).toBe('number');
  });

  it('query_certifications by_result returns valid shape', async () => {
    const result = (await client.callTool('query_certifications', {
      query_type: 'by_result',
    })) as { breakdown: Array<{ result: string; count: number }> };
    expect(Array.isArray(result.breakdown)).toBe(true);
  });

  it('query_certifications by_zip averages PCEP scores per zip', async () => {
    const result = (await client.callTool('query_certifications', {
      query_type: 'by_zip',
      type: 'PCEP',
    })) as { breakdown: Array<{ zip: string; count: number; avg_score: number }> };
    const byZip = new Map(result.breakdown.map((r) => [r.zip, r]));
    expect(byZip.get('19125')).toMatchObject({ count: 1, avg_score: 82 });
    expect(byZip.get('19141')).toMatchObject({ count: 1, avg_score: 90 });
    expect(byZip.get('19139')).toMatchObject({ count: 1, avg_score: 58 });
  });

  it('query_competency scores returns valid shape', async () => {
    const result = (await client.callTool('query_competency', {
      query_type: 'scores',
    })) as {
      record_count: number;
      records: Array<{ student_number: string; competency: string }>;
    };
    expect(typeof result.record_count).toBe('number');
    expect(Array.isArray(result.records)).toBe(true);
  });

  it('query_attendance aggregate returns valid shape', async () => {
    const result = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
    })) as {
      overall: { student_count: number; attendance_rate_pct: number | null };
      breakdown: Array<{ group: string; student_count: number }>;
    };
    expect(typeof result.overall.student_count).toBe('number');
    expect(Array.isArray(result.breakdown)).toBe(true);
  });

  it('query_students list returns seeded students', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'list',
    })) as {
      student_count: number;
      students: Array<{ canonical_name: string }>;
    };
    expect(result.student_count).toBe(3);
    const names = result.students.map((s) => s.canonical_name).sort();
    expect(names).toEqual(['Janelle Brooks', 'Maria Garcia', 'Tai Pham']);
  });

  it('query_students breakdown by zip returns one group per seeded zip', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'breakdown',
      field: 'zip',
    })) as { breakdown: Array<{ value: string; count: number }> };
    const zips = result.breakdown.map((b) => b.value).sort();
    expect(zips).toEqual(['19125', '19139', '19141']);
    expect(result.breakdown.every((b) => b.count === 1)).toBe(true);
  });

  it('query_students breakdown by school_name returns one group per seeded school', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'breakdown',
      field: 'school_name',
    })) as { breakdown: Array<{ value: string; count: number }> };
    const schools = result.breakdown.map((b) => b.value).sort();
    expect(schools).toEqual(['Kensington CAPA', 'Olney High School', 'West Philadelphia High School']);
  });

  it('query_students breakdown by hs_graduation_year groups students by class year', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'breakdown',
      field: 'hs_graduation_year',
    })) as { breakdown: Array<{ value: number; count: number }> };
    const byYear = new Map(result.breakdown.map((b) => [b.value, b.count]));
    expect(byYear.get(2025)).toBe(2); // Maria Garcia + Janelle Brooks
    expect(byYear.get(2024)).toBe(1); // Tai Pham
  });

  it('query_students list filters by school (partial match)', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'list',
      school: 'olney',
    })) as { students: Array<{ canonical_name: string; school_name: string }> };
    expect(result.students.map((s) => s.canonical_name)).toEqual(['Tai Pham']);
    expect(result.students[0]?.school_name).toBe('Olney High School');
  });

  it('query_students list filters by dob range', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'list',
      dob_start: '2007-01-01',
    })) as { students: Array<{ canonical_name: string }> };
    const names = result.students.map((s) => s.canonical_name).sort();
    expect(names).toEqual(['Janelle Brooks', 'Maria Garcia']); // both born in 2007; Tai born 2006
  });

  it('query_students breakdown by withdrawal_code groups withdrawn students', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'breakdown',
      field: 'withdrawal_code',
    })) as { breakdown: Array<{ value: string | null; count: number }> };
    const byCode = new Map(result.breakdown.map((b) => [b.value, b.count]));
    expect(byCode.get('W2')).toBe(1); // Tai Pham
    expect(byCode.get(null)).toBe(2); // Maria Garcia + Janelle Brooks, still enrolled
  });

  it('query_students list filters by withdrawal_code', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'list',
      withdrawal_code: 'W2',
    })) as { students: Array<{ canonical_name: string; withdrawal_date: string }> };
    expect(result.students.map((s) => s.canonical_name)).toEqual(['Tai Pham']);
    expect(result.students[0]?.withdrawal_date).toContain('2026-03-01');
  });

  it('query_students list filters by withdrawal_date range', async () => {
    const result = (await client.callTool('query_students', {
      query_type: 'list',
      withdrawal_date_start: '2026-01-01',
    })) as { students: Array<{ canonical_name: string }> };
    expect(result.students.map((s) => s.canonical_name)).toEqual(['Tai Pham']);
  });

  // Repointed at the development:* CRM tabs by #306. This used to assert against the seeded
  // `donor_contacts` rows — a table no connector writes, so the assertion passed locally and the
  // tool returned nothing in production. It now reads the same tabs `query_finances dev_*` serves.
  it('query_donors summary reads the development CRM tabs, Launchpad-scoped by default', async () => {
    const result = (await client.callTool('query_donors', {
      query_type: 'summary',
    })) as {
      total_donors: number;
      scope: string;
      lifetime_giving: { total: number; contributing_gifts: number };
    };
    expect(result.scope).toBe('launchpad_only');
    expect(result.total_donors).toBe(2);
    // Launchpad-scoped: William Penn's $425,000 Launchpad gift plus Christian's $5,000 + $100.
    // The $75,000 Network gift is deliberately excluded.
    expect(result.lifetime_giving.total).toBe(430100);
    expect(result.lifetime_giving.contributing_gifts).toBe(3);
  });

  it('query_donors summary widens to all Building 21 scope on request', async () => {
    const result = (await client.callTool('query_donors', {
      query_type: 'summary',
      launchpad_only: false,
    })) as { scope: string; lifetime_giving: { total: number } };
    expect(result.scope).toBe('all_building21');
    // The same three gifts plus the $75,000 Network Unrestricted one.
    expect(result.lifetime_giving.total).toBe(505100);
  });

  it('query_donors profile splits giving by project, so a Launchpad share is never mistaken for the whole grant', async () => {
    const result = (await client.callTool('query_donors', {
      query_type: 'profile',
      donor_name: 'William Penn',
      launchpad_only: false,
    })) as {
      matched_name: string;
      contact_id: string;
      giving_summary: { total: number; by_project: Record<string, number>; by_fiscal_year: Record<string, number> };
      grants_tracker: Array<{ lifetime_total: number; program_officer: string | null }>;
      prospect_pipeline: Array<{ prospect_id: string }>;
    };
    expect(result.matched_name).toBe('William Penn Foundation');
    expect(result.contact_id).toBe('D-197');
    expect(result.giving_summary.total).toBe(500000);
    expect(result.giving_summary.by_project).toEqual({ Launchpad: 425000, Network: 75000 });
    expect(result.giving_summary.by_fiscal_year).toEqual({ FY25: 500000 });
    expect(result.grants_tracker[0]?.lifetime_total).toBe(500000);
    // `[VP]` is a withholding marker in the sheet, not a value — it must not reach the caller.
    expect(result.grants_tracker[0]?.program_officer).toBeNull();
    expect(result.prospect_pipeline[0]?.prospect_id).toBe('P-0041');
  });

  it('query_donors profile reports a prior decline rather than staying silent about it', async () => {
    const result = (await client.callTool('query_donors', {
      query_type: 'profile',
      donor_name: 'Eagles Social Justic Fund',
    })) as { prior_declines: Array<{ asked: number }>; prior_declines_note?: string };
    expect(result.prior_declines).toHaveLength(1);
    expect(result.prior_declines[0]?.asked).toBe(25000);
    expect(result.prior_declines_note).toContain('first-approach framing would be wrong');
  });

  it('query_donors list filters by donor type', async () => {
    const result = (await client.callTool('query_donors', {
      query_type: 'list',
      donor_type: 'Foundations',
    })) as { total_matching: number; donors: Array<{ donor_name: string; contact_id: string }> };
    expect(result.total_matching).toBe(1);
    expect(result.donors[0]?.donor_name).toBe('William Penn Foundation');
  });

  it('query_donors distinguishes out-of-scope from absent, instead of one ambiguous no_records', async () => {
    const result = (await client.callTool('query_donors', {
      query_type: 'profile',
      donor_name: 'Nobody At All',
    })) as { error?: { code: string; message: string } };
    expect(result.error?.code).toBe('no_records');
    expect(result.error?.message).toContain('development:contacts');
  });

  it('get_entity_brief surfaces student profile', async () => {
    const result = (await client.callTool('get_entity_brief', {
      person_name: 'Maria Garcia',
    })) as {
      entity: { canonical_name: string; entity_type: string };
      profile: { current_phase: string };
      certifications: Array<{ type: string | null; result: string | null }>;
      phase_progression: Array<{ phase: string; status: string | null }>;
      sources_active: string[];
    };
    expect(result.entity.entity_type).toBe('student');
    expect(result.entity.canonical_name).toBe('Maria Garcia');
    expect(result.profile.current_phase).toBe('101');
    expect(Array.isArray(result.certifications)).toBe(true);
    expect(Array.isArray(result.phase_progression)).toBe(true);
    expect(result.sources_active).toContain('google_sheets');
  });

  // The G3 gate condition: a full form fixture returns a draft package and a figure work order,
  // through the real server rather than through the library. `aug7_truist` is the richest fixture —
  // 17 questions, every one with a stated limit.
  it('grant_build_draft returns a draft package and a figure work order for a full form', async () => {
    const registered = (await client.listTools()).map((t) => t.name);
    const result = (await client.callTool('grant_build_draft', {
      form_id: 'aug7_truist',
    })) as {
      form: { funder: string };
      summary: {
        total: number;
        by_status: Record<string, number>;
        by_actor: { none: number; llm: number; staff: number };
      };
      results: Array<{
        incoming: string;
        status: string;
        actor: string;
        action: string;
        handback?: { task: string; source_text: string; rules: string[]; verify_with: string };
        /** The other half of the llm payload: a `fetch_figure` result owes a lookup, not a rewrite. */
        figure_call?: { tool: string; args: Record<string, string> };
      }>;
      kb_refs_used: string[];
      figure_work_order: {
        policy: string;
        items: Array<{ key: string; tool: string; args: Record<string, string> }>;
        definitional_conflicts: string[];
      };
      your_tasks: Array<{ status: string; count: number; questions: number[]; next_step: string }>;
      staff_actions: Array<{ status: string; count: number; questions: number[]; next_step: string }>;
      markdown: string;
    };

    expect(result.form.funder).toContain('Truist');
    expect(result.summary.total).toBe(17);
    expect(result.results).toHaveLength(17);
    for (const r of result.results) expect(r.action.length).toBeGreaterThan(0);

    // The work order is the deliverable that keeps figures honest: it must name calls to make.
    expect(result.figure_work_order.items.length).toBeGreaterThan(0);
    expect(result.kb_refs_used.length).toBeGreaterThan(0);
    for (const item of result.figure_work_order.items) {
      expect(item.tool).toMatch(/^(query_|get_|search_)/);
    }
    // This form draws on kb.metrics, whose "145 served" is a definitional conflict, not drift.
    expect(result.figure_work_order.definitional_conflicts.length).toBeGreaterThan(0);

    // Outstanding work is split by who does it, and the model's share arrives ready to do: the
    // handback carries the source text and the guardrail, so no second tool call is needed to start.
    expect(result.your_tasks.length).toBeGreaterThan(0);
    expect(result.staff_actions.length).toBeGreaterThan(0);
    expect(result.summary.by_actor.llm).toBeGreaterThan(0);
    expect(result.summary.by_actor.staff).toBeGreaterThan(0);
    expect(
      result.summary.by_actor.none + result.summary.by_actor.llm + result.summary.by_actor.staff,
    ).toBe(17);

    for (const r of result.results) {
      if (r.actor !== 'llm') continue;
      // Two kinds of model work, and they carry different payloads. A `fetch_figure` result owes a
      // LOOKUP, not a rewrite: there is no source text to shape and nothing to resize, so it carries
      // the exact `query_*` call instead of a handback. Asserting a handback here is what broke when
      // D1b added the status — the contract was written when shaping was the only model work there was.
      if (r.figure_call !== undefined) {
        expect(r.figure_call.tool.length).toBeGreaterThan(0);
        expect(r.handback).toBeUndefined();
        continue;
      }
      expect(r.handback?.source_text.length).toBeGreaterThan(0);
      // Every handback carries a no-invention guardrail, whatever its task. The third alternative is
      // `fill_figures` (work package #275), which states the rule about the thing it can invent — a
      // figure — rather than about facts in general: "Do NOT invent a figure and do NOT delete the
      // sentence to make the gap disappear". Matching on wording is fragile, and it is deliberate: the
      // property under test is that the rule is *stated to the model*, which only its text can show.
      expect(r.handback?.rules.join(' ')).toMatch(
        /NEVER invent|ONLY from the source material|Do NOT invent a figure/,
      );
      // The re-measure step must name a REGISTERED tool. G4 registered grant_resize_answer, so this
      // asserts against tools/list rather than against a hard-coded name — the property that matters
      // is reachability, and it is the one that broke when the name was chosen by hand.
      const target = r.handback?.verify_with ?? '';
      expect(registered.some((n) => target.includes(n))).toBe(true);
      expect(target).toContain('grant_resize_answer');
    }

    expect(result.markdown).toContain('not submittable as-is');

    // THE INVARIANT, stated once and directly. The loop above checks each payload's shape; this
    // checks that a payload exists at all and that there is never more than one, which is the
    // property a caller actually depends on: it can walk `results`, filter to actor `llm`, and know
    // every remaining item tells it what to do. D1b's `fetch_figure` broke the old form of this
    // ("actor llm implies handback") by adding a second kind of model work; the fix was to widen the
    // contract rather than to force a lookup into a handback shaped for rewriting text.
    const llm = result.results.filter((r) => r.actor === 'llm');
    expect(llm.length).toBeGreaterThan(0);
    for (const r of llm) {
      const payloads = [r.handback, r.figure_call].filter((p) => p !== undefined);
      expect(payloads).toHaveLength(1);
    }
  });

  // grant_resize_answer, gate G4. Two calls, because the loop is the point: the tool measures and the
  // caller rewrites. Driven through the real server so the zod schema and the runTool envelope are
  // exercised, not just the library.
  it('grant_resize_answer hands back on the first call and accepts a fitting rewrite on the second', async () => {
    const source = 'one two three four five six';
    const first = (await client.callTool('grant_resize_answer', {
      text: source,
      limit: { unit: 'words', max: 3 },
      funder: 'ACME Fund',
    })) as {
      notes: string;
      accepted: boolean;
      text: string | null;
      units_before: number;
      handback?: { task: string; source_text: string; rules: string[]; verify_with: string };
    };
    expect(first.notes).toBe('rewrite_owed');
    expect(first.accepted).toBe(false);
    expect(first.text).toBeNull();
    expect(first.units_before).toBe(6);
    expect(first.handback?.task).toBe('resize');
    expect(first.handback?.source_text).toBe(source);
    expect(first.handback?.rules.join(' ')).toContain('NEVER invent');

    const second = (await client.callTool('grant_resize_answer', {
      text: source,
      limit: { unit: 'words', max: 3 },
      rewrite: 'one two three',
    })) as { notes: string; accepted: boolean; text: string | null; units_after: number };
    expect(second.notes).toBe('fits');
    expect(second.accepted).toBe(true);
    expect(second.text).toBe('one two three');
    expect(second.units_after).toBe(3);
  });

  it('grant_resize_answer rejects a fitting rewrite that states a figure the source does not', async () => {
    const result = (await client.callTool('grant_resize_answer', {
      text: 'We served 145 young people across two campuses.',
      limit: { unit: 'words', max: 5 },
      rewrite: 'We served 180 young people.',
    })) as {
      notes: string;
      accepted: boolean;
      fits_after_resize: boolean;
      text: string | null;
      figure_check: { ok: boolean; invented: string[] };
    };
    // It fits. Length alone would pass it, which is why `accepted` is the field to branch on.
    expect(result.fits_after_resize).toBe(true);
    expect(result.notes).toBe('figures_altered');
    expect(result.accepted).toBe(false);
    expect(result.text).toBeNull();
    expect(result.figure_check.invented).toContain('180');
  });

  // `limit` and `text` being present at all is the schema's job — the SDK rejects a missing one before
  // the handler runs, so there is nothing for a tool test to assert there. What the schema cannot
  // express is that `min(1)` accepts whitespace, and measuring whitespace reports "0 words, fits" for
  // a field nobody filled in. That is the reachable error, so that is the one under test.
  it('grant_resize_answer refuses whitespace as an answer', async () => {
    const result = (await client.callTool('grant_resize_answer', {
      text: '   ',
      limit: { unit: 'words', max: 10 },
    })) as { error?: { code: string; message: string } };
    expect(result.error?.code).toBe('no_records');
    expect(result.error?.message).toContain('Whitespace is not an answer');
  });

  // grant_verify_figure, WP #321. Driven through the real server so the zod schema (`query_result` as
  // z.unknown()) and the runTool envelope are exercised, not just verifyFigureAnswer directly.
  it('grant_verify_figure rejects a drafted number the caller\'s own query result does not carry', async () => {
    const result = (await client.callTool('grant_verify_figure', {
      answer_text: 'Participants earned $350,268 in total wages.',
      figure_call: { tool: 'query_employment', args: { query_type: 'aggregate' } },
      query_result: { wages_total: 362030.26, wage_participants: 45 },
    })) as { error?: { code: string; message: string; suggestions?: string[] } };
    expect(result.error?.code).toBe('needs_input');
    expect(result.error?.message).toContain('$350,268');
    expect(result.error?.suggestions?.join(' ')).toContain('362030.26');
  });

  it('grant_verify_figure passes a drafted number that matches the caller\'s own query result', async () => {
    const result = (await client.callTool('grant_verify_figure', {
      answer_text: 'Participants earned $362,030.26 in total wages.',
      figure_call: { tool: 'query_employment', args: { query_type: 'aggregate' } },
      query_result: { wages_total: 362030.26, wage_participants: 45 },
    })) as { matched: boolean; drafted_figures: string[] };
    expect(result.matched).toBe(true);
    expect(result.drafted_figures).toEqual(['$362,030.26']);
  });

  // The defect this pins: `your_tasks` and `staff_actions` were built from two hand-written maps keyed
  // on `string`, and the builder iterated the MAP's keys — so a status absent from both maps counted
  // toward `by_actor` and appeared in neither list. Three were missing (`fetch_figure`, `needs_expand`,
  // `figure_definitional`), and `hamilton_loi_2025` reported `by_actor.llm = 1` with `your_tasks: []`.
  //
  // Asserted as a conservation law over every stored fixture rather than as "these three statuses are
  // present", because the failure is structural: any future status that names no next step vanishes the
  // same way, and only the sum catches that. Work package #250.
  it('grant_build_draft accounts for every outstanding result in your_tasks or staff_actions', async () => {
    const forms = [
      'allen_hiles_2024',
      'aug7_gsk',
      'aug7_truist',
      'dolfinger_mcmahon_2023',
      'hamilton_loi_2025',
      'jevs_c2l_2024',
      'jff_ai_pathways_2026',
      'sample_incoming',
      'sample_philly_innovation',
      'wpf_workforce_2026',
    ];

    for (const form_id of forms) {
      const result = (await client.callTool('grant_build_draft', {
        form_id,
        include_markdown: false,
      })) as {
        summary: { by_actor: { none: number; llm: number; staff: number } };
        results: Array<{ status: string; actor: string }>;
        your_tasks: Array<{ status: string; count: number; next_step: string }>;
        staff_actions: Array<{ status: string; count: number; next_step: string }>;
      };

      const sum = (items: Array<{ count: number }>): number =>
        items.reduce((n, i) => n + i.count, 0);

      expect(sum(result.your_tasks), `${form_id}: your_tasks vs by_actor.llm`).toBe(
        result.summary.by_actor.llm,
      );
      expect(sum(result.staff_actions), `${form_id}: staff_actions vs by_actor.staff`).toBe(
        result.summary.by_actor.staff,
      );

      // Every listed item must actually tell the caller what to do — an entry with an empty
      // `next_step` is the same dead end as a missing entry, just harder to notice.
      for (const item of [...result.your_tasks, ...result.staff_actions]) {
        expect(item.next_step.length, `${form_id}: ${item.status} next_step`).toBeGreaterThan(0);
      }

      // And the split must agree with each result's own `actor`, not with a second hand-kept mapping.
      const llmStatuses = new Set(result.your_tasks.map((t) => t.status));
      const staffStatuses = new Set(result.staff_actions.map((t) => t.status));
      for (const r of result.results) {
        if (r.actor === 'llm') expect(llmStatuses).toContain(r.status);
        if (r.actor === 'staff') expect(staffStatuses).toContain(r.status);
      }
    }
  });

  // The sibling of the `text` case above, on the other input. `min(1)` accepts a single space, and a
  // blank rewrite measures 0 units — so it fits every limit — and states no figure, so nothing is
  // invented. Both guards passed it: a 95-word answer plus `rewrite: '   '` came back
  // `accepted: true`, `text: '   '`. Work package #251.
  it('grant_resize_answer refuses whitespace as a rewrite', async () => {
    const result = (await client.callTool('grant_resize_answer', {
      text: 'We served 145 young people and placed 88 of them into jobs.',
      limit: { unit: 'words', max: 5 },
      rewrite: '   ',
    })) as { error?: { code: string; message: string } };
    expect(result.error?.code).toBe('no_records');
    expect(result.error?.message).toContain('Whitespace is not a rewrite');
  });

  it('grant_build_draft rejects an unknown form fixture', async () => {
    const result = (await client.callTool('grant_build_draft', {
      form_id: 'no_such_form',
    })) as { error?: { code: string } };
    expect(result.error?.code).toBe('entity_not_found');
  });

  it('grant_build_draft requires a funder alongside inline questions', async () => {
    const result = (await client.callTool('grant_build_draft', {
      questions: [{ text: 'What is your mission?' }],
    })) as { error?: { code: string } };
    expect(result.error?.code).toBe('no_records');
  });

  it('grant_build_draft asks for program and framing before drafting, rather than assume', async () => {
    const result = (await client.callTool('grant_build_draft', {
      questions: [{ text: 'What is your mission?' }],
      funder: 'Example Foundation',
    })) as { error?: { code: string; message: string; suggestions?: string[] } };
    expect(result.error?.code).toBe('needs_input');
    expect(result.error?.message).toContain('program');
    expect(result.error?.message).toContain('framing');
    expect(result.error?.suggestions?.some((s) => s.startsWith('program:'))).toBe(true);
    expect(result.error?.suggestions?.some((s) => s.startsWith('framing:'))).toBe(true);
  });

  it('grant_build_draft drafts once program and framing are supplied', async () => {
    const result = (await client.callTool('grant_build_draft', {
      questions: [{ text: 'What is your mission?' }],
      funder: 'Example Foundation',
      program: 'LiftOff',
      framing: 'initiative',
    })) as { error?: { code: string }; summary?: { total: number } };
    expect(result.error).toBeUndefined();
    expect(result.summary?.total).toBe(1);
  });

  it('grant_build_draft rejects a framing value outside the three fiscal-sponsorship postures', async () => {
    // Enforced by the input schema itself (a z.enum), so the MCP layer refuses the call before it
    // ever reaches the handler — not a toolError envelope.
    await expect(
      client.callTool('grant_build_draft', {
        questions: [{ text: 'What is your mission?' }],
        funder: 'Example Foundation',
        program: 'LiftOff',
        framing: 'not_a_real_posture',
      }),
    ).rejects.toThrow();
  });
});
