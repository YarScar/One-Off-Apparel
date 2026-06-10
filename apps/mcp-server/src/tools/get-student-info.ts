import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma, resolveEntity, getAliases } from '@lp-ai/lib-db';

import { runTool, parseStr } from '../tool-helpers.js';
import { toolError } from '../errors.js';

const NAME = 'get_student_info';

const DESCRIPTION =
  'Get structured profile information for a student — grade, cohort, program, IEP/ELL status, interests, goals, and known aliases across all data sources. The `school_name` field on this profile is the **high school** the student attended before/during Launchpad. For college/university attendance, use `query_postsecondary` instead. Use this tool to understand who a student is before asking follow-up questions about their attendance or outcomes.';

const inputSchema = {
  student_name: z.string().describe('Name, nickname, or ID of the student.'),
};

export function registerGetStudentInfo(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const studentName = parseStr(raw, 'student_name') ?? '';
      if (!studentName.trim()) {
        return toolError(
          'entity_not_found',
          'student_name is required and must be a non-empty string.',
        );
      }

      const resolved = await resolveEntity(studentName, { entityType: 'student' });
      if (!resolved || !resolved.student) {
        return toolError(
          'entity_not_found',
          `Could not resolve '${studentName}' to a known student.`,
        );
      }

      const student = resolved.student;
      const [aliases, info] = await Promise.all([
        getAliases(student.id),
        prisma.studentInfo.findMany({
          where: { studentId: student.id },
          orderBy: { syncedAt: 'desc' },
          take: 1,
        }),
      ]);

      return {
        student: {
          id: student.id,
          canonical_name: student.canonicalName,
          student_number: student.studentNumber,
          email: student.email,
          phone: student.phone,
          current_phase: student.currentPhase,
          enrollment_status: student.enrollmentStatus,
          cohort: student.cohort,
          neighborhood: student.neighborhood,
          distance_to_office: student.distanceToOffice,
          graduation_date: student.graduationDate,
          known_aliases: aliases.map((a) => ({
            source: a.source ?? 'unknown',
            alias: a.alias,
            confidence: a.confidence,
          })),
          drive_notes_excerpt: info[0]?.content.slice(0, 500) ?? null,
        },
        entity_resolved: true,
        entity_confidence: resolved.confidence,
        match_type: resolved.matchType,
      };
    }),
  );
}
