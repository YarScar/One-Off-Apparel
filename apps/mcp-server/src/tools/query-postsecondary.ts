import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '@lp-ai/lib-db';
import type { Prisma } from '@lp-ai/lib-db';

import { runTool, parseStr } from '../tool-helpers.js';

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

const DESCRIPTION = `**Postsecondary (college/university) enrollment data** from the National Student Clearinghouse — every college or university each Launchpad student has attended, enrollment status, class level, majors, and graduation outcomes. Useful for tracking college persistence and completion rates. ` +
  `IMPORTANT: This is NOT the student's high school. The high school they attended before/during Launchpad lives in the students table (\`school_name\` column), accessible via \`get_student_info\` or \`query_students\`. If a user asks about "school" or "schools" without specifying, confirm whether they mean high school or college/university before answering. ` +
  `Enrollment status codes: ${ENROLLMENT_STATUS_DESCRIPTIONS}. ` +
  `Class level codes: ${CLASS_LEVEL_DESCRIPTIONS}.`;

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
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? '';

      const institution = parseStr(raw, 'institution');
      const institutionType = parseStr(raw, 'institution_type');
      const enrollmentStatus = parseStr(raw, 'enrollment_status');
      const classLevel = parseStr(raw, 'class_level');
      const studentNumber = parseStr(raw, 'student_number');
      const startDate = parseStr(raw, 'start_date');
      const endDate = parseStr(raw, 'end_date');
      const graduatedOnly = raw['graduated_only'] === true;

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
