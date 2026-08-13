import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, filterStr } from '../tool-helpers.js';
import { unmatchableFilterError, type FilterDomainCheck } from '../filter-domain.js';
import {
  postsecondaryEnrollmentStatusDomain,
  postsecondaryClassLevelDomain,
} from '../filter-domain-loaders.js';

const NAME = 'query_postsecondary';

// National Student Clearinghouse single-letter codes — kept here so the tool's
// description tells Claude how to interpret the values it sees in the data.
const ENROLLMENT_STATUS_DESCRIPTIONS = [
  'F=Full-time',
  'Q=Three-quarter',
  'H=Half-time',
  'L=Less than half',
  'A=Leave of absence',
  'W=Withdrawn',
  'D=Deceased',
].join(', ');

const CLASS_LEVEL_DESCRIPTIONS = [
  'F=Freshman',
  'S=Sophomore',
  'J=Junior',
  'R=Senior',
  'C=Undergrad cert',
  'N=Undergrad unspec',
  'A=Associate',
  'B=Bachelor',
  'M=Master',
  'D=Doctoral',
  'P=Postdoc',
  'L=First professional',
  'G=Grad unspec',
  'T=Post-bacc cert',
].join(', ');

const DESCRIPTION = `Postsecondary enrollment data from National Student Clearinghouse — colleges + universities each Launchpad student attended, enrollment status, class level, majors, and graduation outcomes. Useful for tracking college persistence and completion rates. ` +
  `Enrollment status codes: ${ENROLLMENT_STATUS_DESCRIPTIONS}. ` +
  `Class level codes: ${CLASS_LEVEL_DESCRIPTIONS}. ` +
  `enrollment_status and class_level are matched literally against these codes; a value absent from its column returns a no_records error listing the codes actually present, rather than an empty answer. institution and institution_type are substring matches and are not checked that way.`;

const inputSchema = {
  query_type: z.enum([
    'summary',
    'by_institution',
    'by_status',
    'by_class_level',
    'graduates',
    'records',
  ]),
  institution: z.string().optional().describe('Partial institution name match.'),
  institution_type: z.string().optional().describe('Filter by institutionType (e.g. 4-year, 2-year).'),
  enrollment_status: z.string().optional().describe('Single-letter NSC code (F/Q/H/L/A/W/D).'),
  class_level: z.string().optional().describe('Single-letter NSC class-level code.'),
  graduated_only: z.boolean().optional().describe('Restrict to records where graduated=true.'),
  student_number: z.string().optional().describe('Limit to one student by their Launchpad student number.'),
  start_date: z.string().optional().describe('ISO date — restrict to enrollment_begin >= this.'),
  end_date: z.string().optional().describe('ISO date — restrict to enrollment_begin <= this.'),
};

export function registerQueryPostsecondary(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = filterStr(raw, 'query_type') ?? '';

      const institution = filterStr(raw, 'institution');
      const institutionType = filterStr(raw, 'institution_type');
      const enrollmentStatus = filterStr(raw, 'enrollment_status');
      const classLevel = filterStr(raw, 'class_level');
      const studentNumber = filterStr(raw, 'student_number');
      const startDate = filterStr(raw, 'start_date');
      const endDate = filterStr(raw, 'end_date');
      const graduatedOnly = raw['graduated_only'] === true;

      /**
       * The two exact-match filters, domain-checked before any branch (#210). The NSC
       * codes are enumerated in the description above, which makes a wrong value less
       * likely here than on `query_students` — but only the description knows them, and
       * a caller who sends `enrollment_status: 'Enrolled'` still got a well-formed zero
       * from every one of the six query types.
       *
       * The domain read is the column's own values, not the code list: a code that is
       * valid NSC but absent from Launchpad's data still cannot match, and telling the
       * caller which codes are present is the answer that costs one round trip.
       *
       * `institution` and `institution_type` are `contains` matches and are deliberately
       * excluded — see the note in `query-students.ts`. `graduated_only` is a boolean,
       * and the dates are windows.
       */
      const checks: FilterDomainCheck[] = [];
      if (enrollmentStatus !== undefined) {
        checks.push({
          field: 'enrollment_status',
          column: 'student_postsecondary.enrollment_status',
          value: enrollmentStatus,
          domain: await postsecondaryEnrollmentStatusDomain(),
        });
      }
      if (classLevel !== undefined) {
        checks.push({
          field: 'class_level',
          column: 'student_postsecondary.class_level',
          value: classLevel,
          domain: await postsecondaryClassLevelDomain(),
        });
      }
      const domainError = unmatchableFilterError(checks);
      if (domainError) return domainError;

      const where: Prisma.StudentPostsecondaryWhereInput = {};
      if (institution) where.institution = { contains: institution, mode: 'insensitive' };
      if (institutionType) where.institutionType = { contains: institutionType, mode: 'insensitive' };
      if (enrollmentStatus) where.enrollmentStatus = enrollmentStatus;
      if (classLevel) where.classLevel = classLevel;
      if (graduatedOnly) where.graduated = true;
      if (studentNumber) where.studentNumber = studentNumber;
      if (startDate || endDate) {
        where.enrollmentBegin = {};
        if (startDate) where.enrollmentBegin.gte = new Date(startDate);
        if (endDate) where.enrollmentBegin.lte = new Date(endDate);
      }

      switch (queryType) {
        case 'records': {
          const rows = await prisma.studentPostsecondary.findMany({
            where,
            orderBy: [{ enrollmentBegin: 'desc' }, { lastName: 'asc' }],
            take: 500,
          });
          return {
            query_type: 'records',
            record_count: rows.length,
            records: rows.map((r) => ({
              student_number: r.studentNumber,
              name:
                [r.firstName, r.lastName].filter(Boolean).join(' ') ||
                null,
              institution: r.institution,
              institution_type: r.institutionType,
              institution_length: r.institutionLength,
              enrollment_begin: r.enrollmentBegin,
              enrollment_end: r.enrollmentEnd,
              enrollment_status: r.enrollmentStatus,
              class_level: r.classLevel,
              majors: [r.enrollmentMajor1, r.enrollmentMajor2].filter(Boolean),
              graduated: r.graduated,
              graduation_date: r.graduationDate,
              degree_title: r.degreeTitle,
              degree_majors: [r.degreeMajor1, r.degreeMajor2, r.degreeMajor3].filter(Boolean),
            })),
          };
        }
        case 'graduates': {
          const grads = await prisma.studentPostsecondary.findMany({
            where: { ...where, graduated: true },
            orderBy: [{ graduationDate: 'desc' }],
            take: 500,
          });
          return {
            query_type: 'graduates',
            record_count: grads.length,
            records: grads.map((r) => ({
              student_number: r.studentNumber,
              name:
                [r.firstName, r.lastName].filter(Boolean).join(' ') || null,
              institution: r.institution,
              graduation_date: r.graduationDate,
              degree_title: r.degreeTitle,
              degree_majors: [r.degreeMajor1, r.degreeMajor2, r.degreeMajor3].filter(Boolean),
            })),
          };
        }
        case 'by_institution': {
          const grouped = await prisma.studentPostsecondary.groupBy({
            by: ['institution'],
            where,
            _count: { _all: true },
          });
          return {
            query_type: 'by_institution',
            breakdown: grouped
              .map((g) => ({
                institution: g.institution,
                count: g._count?._all ?? 0,
              }))
              .sort((a, b) => b.count - a.count),
          };
        }
        case 'by_status': {
          const grouped = await prisma.studentPostsecondary.groupBy({
            by: ['enrollmentStatus'],
            where,
            _count: { _all: true },
          });
          return {
            query_type: 'by_status',
            status_legend: ENROLLMENT_STATUS_DESCRIPTIONS,
            breakdown: grouped.map((g) => ({
              enrollment_status: g.enrollmentStatus,
              count: g._count?._all ?? 0,
            })),
          };
        }
        case 'by_class_level': {
          const grouped = await prisma.studentPostsecondary.groupBy({
            by: ['classLevel'],
            where,
            _count: { _all: true },
          });
          return {
            query_type: 'by_class_level',
            class_level_legend: CLASS_LEVEL_DESCRIPTIONS,
            breakdown: grouped.map((g) => ({
              class_level: g.classLevel,
              count: g._count?._all ?? 0,
            })),
          };
        }
        case 'summary':
        default: {
          const total = await prisma.studentPostsecondary.count({ where });
          const distinctStudents = await prisma.studentPostsecondary.groupBy({
            by: ['studentNumber'],
            where,
            _count: { _all: true },
          });
          const graduated = await prisma.studentPostsecondary.count({
            where: { ...where, graduated: true },
          });
          return {
            query_type: 'summary',
            total_records: total,
            distinct_students: distinctStudents.length,
            graduates: graduated,
            graduation_rate_pct:
              distinctStudents.length === 0
                ? null
                : Math.round((graduated / distinctStudents.length) * 1000) / 10,
          };
        }
      }
    }),
  );
}
