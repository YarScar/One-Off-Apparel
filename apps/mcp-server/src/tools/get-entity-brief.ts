import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma, resolveEntity, getAliases } from '@lp-ai/lib-db';

import { runTool, parseStr } from '../tool-helpers.js';
import { toolError } from '../errors.js';

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

      const donorMatches = await prisma.donorContact.findMany({
        where: {
          OR: [
            { firstName: { contains: personName, mode: 'insensitive' } },
            { lastName: { contains: personName, mode: 'insensitive' } },
            { organizationName: { contains: personName, mode: 'insensitive' } },
          ],
        },
        take: 3,
      });

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
          const [gifts, pipeline] = await Promise.all([
            prisma.donorGift.findMany({
              where: { donorContactId: topDonor.id },
              orderBy: { giftDate: 'desc' },
            }),
            prisma.donorPipeline.findMany({
              where: { donorContactId: topDonor.id },
            }),
          ]);
          result['donor_profile'] = {
            id: topDonor.id,
            first_name: topDonor.firstName,
            last_name: topDonor.lastName,
            organization_name: topDonor.organizationName,
            email: topDonor.email,
          };
          result['donor_giving_history'] = gifts.map((g) => ({
            amount: g.amount,
            gift_date: g.giftDate,
            campaign_name: g.campaignName,
            fund: g.fund,
            is_recurring: g.isRecurring,
          }));
          result['donor_prospect_pipeline'] = pipeline.map((p) => ({
            stage: p.stage,
            ask_amount: p.askAmount,
            likelihood: p.likelihood,
            notes: p.notes,
          }));
        }
        if (!result['entity']) {
          result['entity'] = {
            id: topDonor?.id ?? null,
            canonical_name:
              topDonor?.organizationName ??
              `${topDonor?.firstName ?? ''} ${topDonor?.lastName ?? ''}`.trim(),
            entity_type: 'donor',
          };
        }
      }

      return result;
    }),
  );
}
