import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma, resolveEntity, getAliases } from '@lp-ai/lib-db';

import { runTool, parseStr } from '../tool-helpers.js';
import { toolError } from '../errors.js';
import {
  DEV_TABS,
  cell,
  donorNameOf,
  nameMatches,
  parseMoney,
  readDevTab,
  rowsForDonor,
  summariseGiving,
} from '../dev-crm.js';

const NAME = 'get_entity_brief';

const DESCRIPTION =
  'Get a comprehensive brief on a student: profile, phase progression, certifications, and recent Drive document mentions. Also surfaces donor information when the named person matches a Development CRM donor.';

const SOURCES_ACTIVE = ['google_sheets', 'google_drive'] as const;
const SOURCES_DEFERRED = ['bigquery_attendance', 'slack', 'notion'] as const;

const inputSchema = {
  person_name: z
    .string()
    .describe('Name, nickname, or handle of the student, staff member, or donor.'),
};

export function registerGetEntityBrief(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const personName = parseStr(raw, 'person_name') ?? '';
      if (!personName.trim()) {
        return toolError('entity_not_found', 'person_name is required.');
      }

      const resolved = await resolveEntity(personName);

      // Repointed at the Development CRM sheet tabs, #306. This read `donor_contacts`, which no
      // connector writes, so the donor arm of this brief was dead in production: an org that is a
      // major funder resolved as "not a student, staff member, or donor".
      const allDonorRows = await readDevTab(DEV_TABS.contacts);
      const donorMatches = allDonorRows.filter((r) => nameMatches(r, personName)).slice(0, 3);

      if (!resolved && donorMatches.length === 0) {
        return toolError(
          'entity_not_found',
          `Could not resolve '${personName}' to a student, staff member, or donor.`,
        );
      }

      const result: Record<string, unknown> = {
        sources_active: SOURCES_ACTIVE,
        sources_deferred: SOURCES_DEFERRED,
      };

      if (resolved?.student) {
        const student = resolved.student;
        const [phaseOutcome, certifications, aliases, info] = await Promise.all([
          prisma.studentPhaseOutcome.findUnique({ where: { studentId: student.id } }),
          prisma.studentCertification.findMany({
            where: { studentId: student.id },
            orderBy: { date: 'desc' },
          }),
          getAliases(student.id),
          prisma.studentInfo.findMany({
            where: { studentId: student.id },
            orderBy: { syncedAt: 'desc' },
            take: 1,
          }),
        ]);

        result['entity'] = {
          id: student.id,
          canonical_name: student.canonicalName,
          entity_type: 'student',
        };
        result['profile'] = {
          id: student.id,
          student_number: student.studentNumber,
          canonical_name: student.canonicalName,
          email: student.email,
          launchpad_email: student.launchpadEmail,
          alt_school_email: student.altSchoolEmail,
          current_phase: student.currentPhase,
          enrollment_status: student.enrollmentStatus,
          neighborhood: student.neighborhood,
        };
        result['known_aliases'] = aliases.map((a) => ({
          source: a.source,
          alias: a.alias,
          confidence: a.confidence,
        }));
        result['phase_progression'] = phaseOutcome
          ? [
              { phase: 'Foundations', status: phaseOutcome.foundationsStatus, start_date: phaseOutcome.foundationsStartDate, end_date: phaseOutcome.foundationsEndDate },
              { phase: '101', status: phaseOutcome.phase101Status, start_date: phaseOutcome.phase101StartDate, end_date: phaseOutcome.phase101EndDate },
              { phase: 'Lightspeed', status: phaseOutcome.lightspeedStatus, start_date: phaseOutcome.lightspeedStartDate, end_date: phaseOutcome.lightspeedEndDate },
              { phase: 'LiftOff', status: phaseOutcome.liftoffStatus, start_date: phaseOutcome.liftoffStartDate, end_date: phaseOutcome.liftoffEndDate },
            ].filter((p) => p.status !== null || p.start_date !== null)
          : [];
        result['certifications'] = certifications.map((c) => ({
          type: c.type,
          phase: c.phase,
          result: c.result,
          score: c.score,
          date: c.date,
        }));
        result['drive_notes_excerpt'] = info[0]?.content.slice(0, 1000) ?? null;
        result['entity_confidence'] = resolved.confidence;
      } else if (resolved?.staff) {
        const staff = resolved.staff;
        result['entity'] = {
          id: staff.id,
          canonical_name: staff.canonicalName,
          entity_type: 'staff',
        };
        result['profile'] = {
          id: staff.id,
          canonical_name: staff.canonicalName,
          email: staff.email,
          role: staff.role,
        };
        result['entity_confidence'] = resolved.confidence;
      }

      if (donorMatches.length > 0) {
        const [topDonor] = donorMatches;
        if (topDonor) {
          const contactId = cell(topDonor, 'contact_id');
          const resolvedName = donorNameOf(topDonor);
          const [historyAll, pipelineAll] = await Promise.all([
            readDevTab(DEV_TABS.givingHistory),
            readDevTab(DEV_TABS.prospectPipeline),
          ]);
          const gifts = rowsForDonor(historyAll, contactId, resolvedName);
          const pipeline = rowsForDonor(pipelineAll, contactId, resolvedName);
          const giving = summariseGiving(gifts);
          result['donor_profile'] = {
            contact_id: contactId,
            donor_name: resolvedName,
            donor_type: cell(topDonor, 'donor_type_coa'),
            status: cell(topDonor, 'status'),
            projects: cell(topDonor, 'projects'),
            primary_email: cell(topDonor, 'primary_email'),
            relationship_owner: cell(topDonor, 'relationship_owner'),
          };
          // All-Building-21 scope, and said so rather than implied: this brief takes a bare name and
          // has no scope argument to narrow with. The by_project split is the caller's way to see
          // how much of a total is Launchpad's.
          result['donor_giving_summary'] = {
            scope: 'all_building21',
            total: giving.total,
            gift_count: giving.gift_count,
            by_fiscal_year: giving.by_fiscal_year,
            by_project: giving.by_project,
            source:
              'Summed from development:giving history. The Contacts tab’s lifetime_giving column is ' +
              'wrong at source and is not read. Use query_donors for a Launchpad-scoped total.',
          };
          result['donor_giving_history'] = gifts.map((g) => ({
            gift_id: cell(g, 'gift_id'),
            date: cell(g, 'date'),
            fiscal_year: cell(g, 'fiscal_year'),
            gross_amount: parseMoney(g.data['gross_amount']),
            fund: cell(g, 'fund_name'),
            project: cell(g, 'project'),
            grant_status: cell(g, 'grant_status'),
          }));
          result['donor_prospect_pipeline'] = pipeline.map((p) => ({
            prospect_id: cell(p, 'prospect_id'),
            month: cell(p, 'month'),
            fiscal_year: cell(p, 'fiscal_year'),
            fund: cell(p, 'fund_name'),
            project: cell(p, 'project'),
            grant_status: cell(p, 'grant_status'),
            gross_amount: parseMoney(p.data['gross_amount']),
            projected_amount: parseMoney(p.data['projected_amt']),
          }));
        }
        if (!result['entity']) {
          result['entity'] = {
            // The CRM's own donor key (`D-197`) rather than a database uuid — the typed table this
            // used to read is gone from the path, and its uuids were never stable across seeds.
            id: topDonor ? cell(topDonor, 'contact_id') : null,
            canonical_name: topDonor ? donorNameOf(topDonor) : null,
            entity_type: 'donor',
          };
        }
      }

      return result;
    }),
  );
}
