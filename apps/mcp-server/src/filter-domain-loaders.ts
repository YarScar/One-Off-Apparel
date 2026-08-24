import { prisma } from '@lp-ai/lib-db';

/**
 * The distinct values each domain-checked filter column actually holds.
 *
 * `filter-domain.ts` is the pure half — it takes a `domain` and knows nothing about
 * Prisma. This is the half that reads one. They are separate files so the boundary the
 * fix rests on stays testable without a database, and so these loaders can be shared:
 * `query_students` and `query_enrollment` filter the *same* `students.current_phase` and
 * `students.enrollment_status` columns, and a second copy of either loader is a second
 * place for the two tools to drift apart on what "the values present" means.
 *
 * **Every loader here is deliberately unscoped** — the distinct values of one column
 * across the whole table, never narrowed by the caller's other filters. That is the
 * whole boundary, restated from the header of `filter-domain.ts`: a value absent from
 * its own column can never match and is a bad input, while a combination of values that
 * are each present but co-occur in no row is a truthful zero. Scope a domain by the
 * sibling filters and the second case collapses into the first — the last surviving
 * filter always looks unmatchable, so every real zero becomes a false error. There is no
 * `where` clause on any query below beyond dropping nulls, and there must not be one.
 *
 * Written as one function per column rather than a generic taking a column name because
 * Prisma's `groupBy` result type is keyed by the literal `by` array; a dynamic key
 * erases the field off the row type and costs a cast.
 */

export async function studentCurrentPhaseDomain(): Promise<string[]> {
  const rows = await prisma.student.groupBy({
    by: ['currentPhase'],
    where: { currentPhase: { not: null } },
  });
  return rows.map((r) => r.currentPhase).filter((v): v is string => v !== null);
}

export async function studentEnrollmentStatusDomain(): Promise<string[]> {
  const rows = await prisma.student.groupBy({
    by: ['enrollmentStatus'],
    where: { enrollmentStatus: { not: null } },
  });
  return rows.map((r) => r.enrollmentStatus).filter((v): v is string => v !== null);
}

export async function studentWithdrawalCodeDomain(): Promise<string[]> {
  const rows = await prisma.student.groupBy({
    by: ['withdrawalCode'],
    where: { withdrawalCode: { not: null } },
  });
  return rows.map((r) => r.withdrawalCode).filter((v): v is string => v !== null);
}

export async function studentHsGraduationYearDomain(): Promise<number[]> {
  const rows = await prisma.student.groupBy({
    by: ['hsGraduationYear'],
    where: { hsGraduationYear: { not: null } },
  });
  return rows.map((r) => r.hsGraduationYear).filter((v): v is number => v !== null);
}

export async function postsecondaryEnrollmentStatusDomain(): Promise<string[]> {
  const rows = await prisma.studentPostsecondary.groupBy({
    by: ['enrollmentStatus'],
    where: { enrollmentStatus: { not: null } },
  });
  return rows.map((r) => r.enrollmentStatus).filter((v): v is string => v !== null);
}

export async function postsecondaryClassLevelDomain(): Promise<string[]> {
  const rows = await prisma.studentPostsecondary.groupBy({
    by: ['classLevel'],
    where: { classLevel: { not: null } },
  });
  return rows.map((r) => r.classLevel).filter((v): v is string => v !== null);
}

/** `student_certifications.phase` is non-nullable, so there is no null to drop. */
export async function certificationPhaseDomain(): Promise<string[]> {
  const rows = await prisma.studentCertification.groupBy({ by: ['phase'] });
  return rows.map((r) => r.phase);
}

/**
 * The distinct `current_phase` values held by students who have at least one attendance
 * row, and the student numbers behind each.
 *
 * `attendance_records` has no relation to `students` — it carries a bare
 * `student_number` string (`schema.prisma`, `model AttendanceRecord`) — so scoping
 * attendance to a phase means resolving the student numbers first and filtering on
 * `studentNumber: { in: [...] }`. The domain and the predicate therefore come from one
 * read rather than two, which also makes them impossible to disagree.
 *
 * Note what this is *not* scoped by: the caller's cohort or date filters. It is scoped
 * by "has an attendance row" because that is the population the tool answers over at
 * all, and a phase held only by students with no attendance data has no matching row for
 * any call — reporting it as a value to retry with would just move the false zero one
 * round trip later.
 */
export async function attendanceCurrentPhaseIndex(): Promise<Map<string, string[]>> {
  const rows = await prisma.$queryRaw<Array<{ current_phase: string; student_number: string }>>`
    SELECT DISTINCT s.current_phase AS current_phase, s.student_number AS student_number
    FROM students s
    JOIN attendance_records a ON a.student_number = s.student_number
    WHERE s.current_phase IS NOT NULL AND s.student_number IS NOT NULL
  `;
  const index = new Map<string, string[]>();
  for (const r of rows) {
    const existing = index.get(r.current_phase);
    if (existing) existing.push(r.student_number);
    else index.set(r.current_phase, [r.student_number]);
  }
  return index;
}
