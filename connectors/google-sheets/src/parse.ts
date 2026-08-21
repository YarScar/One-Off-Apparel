// ---------------------------------------------------------------------------
// Column constants
// ---------------------------------------------------------------------------

// ----- V2 Student Information sheet (current source-of-truth as of 2026-05) -----
// 52 cells: A=0..AZ=51. Header-drift guard compares column-by-column before
// reading any data. The V2 sheet replaced the legacy "Student Information for
// Launchpad LLMs" Students + Outcomes tabs.
//
// PII / sensitive fields are excluded from ingest:
//   col 11 IEP/504           — per ops policy
//   col 20 ASU Password      — credentials, never store
//   col 22 SSN               — per ops policy
//   col 25 Street            — repo convention (PII)
//   col 31 Medical/Dietary   — PHI
//   col 43 Age               — derivable from DOB; don't store both
//   col 47 PCEP Score        — redundant with student_certifications
//   col 51 Has Disability?   — sensitive
//   col 42 Cohort            — deprecated; use PhaseCompletion tab (phase + date) instead
export const EXPECTED_STUDENTS_V2_HEADERS = [
  'Student Number',                            // A  0
  'First Name',                                // B  1
  'Last Name',                                 // C  2
  'Suffix',                                    // D  3
  'Status',                                    // E  4 → enrollment_status
  'Grade Level',                               // F  5 → current_phase
  'DOB',                                       // G  6
  'Gender',                                    // H  7
  'Race/Ethnicity',                            // I  8
  'School',                                    // J  9
  'HS Graduation Year',                        // K  10
  'IEP/504',                                   // L  11 — EXCLUDED
  'ELL',                                       // M  12
  'Entry Date',                                // N  13
  'Withdrawl Date',                            // O  14 (sheet spelling)
  'Withdrawl Code',                            // P  15 (sheet spelling)
  'Launchpad Email',                           // Q  16
  'Alternative School Email',                  // R  17 → alt_school_email
  'Personal Email',                            // S  18 — EXCLUDED (PII)
  'ASURITE User ID',                           // T  19
  'ASU Password',                              // U  20 — EXCLUDED (credential)
  'Rapid Account #',                           // V  21
  'Social Security Number',                    // W  22 — EXCLUDED
  'Phone',                                     // X  23
  'Alt. Contact',                              // Y  24
  'Street',                                    // Z  25 — EXCLUDED (PII)
  'City',                                      // AA 26
  'State',                                     // AB 27
  'Zip',                                       // AC 28
  'ID Card #',                                 // AD 29
  'Doc Folder',                                // AE 30 → doc_folder_url
  'Medical/Dietary',                           // AF 31 — EXCLUDED (PHI)
  'T-Shirt Size',                              // AG 32
  'Interview Score',                           // AH 33
  'Algebra Keystone Score',                    // AI 34
  'GPA on Enrollment',                         // AJ 35 → hs_gpa
  'Algebra 1 Grade',                           // AK 36
  'Geometry Grade',                            // AL 37
  'Works outside Launchpad?',                  // AM 38
  'Hours Outside of School/week committed',    // AN 39
  'Permission Slip?',                          // AO 40
  'Extra Time?',                               // AP 41
  'Cohort',                                    // AQ 42 — EXCLUDED (deprecated)
  'Age',                                       // AR 43 — EXCLUDED (use dob)
  'Tech Interest Onboarding',                  // AS 44
  'Interview Passion Score',                   // AT 45
  'Interview College Score',                   // AU 46
  'PCEP Score',                                // AV 47 — EXCLUDED (use certifications)
  'Work Ready Q1',                             // AW 48
  'Household Income',                          // AX 49
  'Parental Education',                        // AY 50
  'Has Disability?',                           // AZ 51 — EXCLUDED (sensitive)
] as const;

// ---------------------------------------------------------------------------
// Parse helpers — return null for absent/empty values
// ---------------------------------------------------------------------------

function str(v: string | undefined): string | null {
  const s = v?.trim();
  return s === '' || s === undefined ? null : s;
}

function parseDate(v: string | undefined): string | null {
  if (!v?.trim()) return null;
  const t = v.trim();

  // ISO YYYY-MM-DD (with optional trailing time) — emitted by Sheets when a
  // cell is formatted as a plain ISO date.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) {
    return `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`;
  }

  // US M/D/YYYY (or M/D/YY). The year alternation must list \d{4} BEFORE \d{2}
  // — JS regex alternation is leftmost-match, so the reverse order would
  // greedily grab the first 2 digits of a 4-digit year ("2025" → "20" → "2020").
  // The (?=\D|$) lookahead anchors the year so we never partial-match a
  // 4-digit year into a shorter capture.
  // 2-digit years are expanded: YY < 70 → 20YY; YY ≥ 70 → 19YY.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?=\D|$)/.exec(t);
  if (us) {
    const m = us[1]!.padStart(2, '0');
    const d = us[2]!.padStart(2, '0');
    const rawY = us[3]!;
    const y = rawY.length === 2
      ? (parseInt(rawY, 10) < 70 ? `20${rawY}` : `19${rawY}`)
      : rawY;
    return `${y}-${m}-${d}`;
  }

  return null;
}

function parseBool(v: string | undefined): boolean | null {
  if (!v?.trim()) return null;
  return v.trim().toUpperCase() === 'Y' || v.trim().toLowerCase() === 'true';
}

function parseNum(v: string | undefined): string | null {
  const s = v?.trim().replace(/,/g, '').replace(/%$/, '');
  return s !== undefined && s !== '' && !isNaN(Number(s)) ? s : null;
}

function parseInt2(v: string | undefined): number | null {
  const n = parseInt(v?.trim() ?? '', 10);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// V2 Students row → typed record (Student Information v2 sheet, "Students" tab)
// ---------------------------------------------------------------------------

export type StudentV2Row = {
  studentNumber: string;
  canonicalName: string;
  suffix: string | null;
  enrollmentStatus: string | null;
  currentPhase: string | null;
  dob: string | null;
  gender: string | null;
  raceEthnicity: string | null;
  schoolName: string | null;
  hsGraduationYear: number | null;
  ell: boolean | null;
  entryDate: string | null;
  withdrawalDate: string | null;
  withdrawalCode: string | null;
  launchpadEmail: string | null;
  altSchoolEmail: string | null;
  asuriteUserId: string | null;
  rapidAccountNumber: string | null;
  phone: string | null;
  altContact: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  idCardNumber: string | null;
  docFolderUrl: string | null;
  tShirtSize: string | null;
  interviewScore: string | null;
  algebraKeystoneScore: string | null;
  hsGpa: string | null;
  algebra1Grade: string | null;
  geometryGrade: string | null;
  worksOutsideLaunchpad: boolean | null;
  hoursOutsideCommitted: string | null;
  permissionSlip: boolean | null;
  extraTime: boolean | null;
  techInterestOnboarding: number | null;
  interviewPassionScore: number | null;
  interviewCollegeScore: number | null;
  workReadyQ1: string | null;
  income: string | null;
  parentalEd: string | null;
};

export function parseStudentV2Row(raw: string[]): StudentV2Row | null {
  const get = (i: number) => raw[i]?.trim();
  const studentNumber = get(0);
  if (!studentNumber) return null;

  const firstName = get(1) ?? '';
  const lastName = get(2) ?? '';

  return {
    studentNumber,
    canonicalName: `${firstName} ${lastName}`.trim(),
    suffix: str(get(3)),
    enrollmentStatus: str(get(4)),
    currentPhase: str(get(5)),
    dob: parseDate(get(6)),
    gender: str(get(7)),
    raceEthnicity: str(get(8)),
    schoolName: str(get(9)),
    hsGraduationYear: parseInt2(get(10)),
    // col 11 IEP/504 — EXCLUDED
    ell: parseBool(get(12)),
    entryDate: parseDate(get(13)),
    withdrawalDate: parseDate(get(14)),
    withdrawalCode: str(get(15)),
    launchpadEmail: str(get(16)),
    altSchoolEmail: str(get(17)),
    // col 18 Personal Email — EXCLUDED (PII)
    asuriteUserId: str(get(19)),
    // col 20 ASU Password — EXCLUDED
    rapidAccountNumber: str(get(21)),
    // col 22 SSN — EXCLUDED
    phone: str(get(23)),
    altContact: str(get(24)),
    // col 25 Street — EXCLUDED (PII)
    city: str(get(26)),
    state: str(get(27)),
    zip: str(get(28)),
    idCardNumber: str(get(29)),
    docFolderUrl: str(get(30)),
    // col 31 Medical/Dietary — EXCLUDED (PHI)
    tShirtSize: str(get(32)),
    interviewScore: parseNum(get(33)),
    algebraKeystoneScore: parseNum(get(34)),
    hsGpa: parseNum(get(35)),
    algebra1Grade: str(get(36)),
    geometryGrade: str(get(37)),
    worksOutsideLaunchpad: parseBool(get(38)),
    hoursOutsideCommitted: parseNum(get(39)),
    permissionSlip: parseBool(get(40)),
    extraTime: parseBool(get(41)),
    // col 42 Cohort — EXCLUDED (deprecated; use PhaseCompletion tab instead)
    // col 43 Age — EXCLUDED (derivable)
    techInterestOnboarding: parseInt2(get(44)),
    interviewPassionScore: parseInt2(get(45)),
    interviewCollegeScore: parseInt2(get(46)),
    // col 47 PCEP Score — EXCLUDED (use certifications)
    workReadyQ1: str(get(48)),
    income: str(get(49)),
    parentalEd: str(get(50)),
    // col 51 Has Disability? — EXCLUDED
  };
}

// ---------------------------------------------------------------------------
// Certifications row → typed record (legacy Student Info sheet)
// ---------------------------------------------------------------------------

export type CertificationRow = {
  sourceId: string;
  studentNumber: string;
  type: string;
  date: string | null;
  result: string;
  score: string | null;
  phase: string;
};

export function parseCertificationRow(raw: string[]): CertificationRow | null {
  const sourceId = raw[0]?.trim();
  const studentNumber = raw[1]?.trim();
  const type = raw[3]?.trim();
  const result = raw[5]?.trim();
  const phase = raw[7]?.trim();
  if (!sourceId || !studentNumber || !type || !result || !phase) return null;

  return {
    sourceId,
    studentNumber,
    type,
    date: str(raw[4]),
    result,
    score: parseNum(raw[6]),
    phase,
  };
}

// ---------------------------------------------------------------------------
// Outcomes row → typed record (V2 sheet's "PhaseCompletion" tab; same 15-col
// shape as the legacy "Outcomes" tab, so the parser is reused unchanged).
// ---------------------------------------------------------------------------

export type OutcomesRow = {
  studentNumber: string;
  foundationsStatus: string | null;
  foundationsStartDate: string | null;
  foundationsEndDate: string | null;
  phase101Status: string | null;
  phase101StartDate: string | null;
  phase101EndDate: string | null;
  lightspeedStatus: string | null;
  lightspeedStartDate: string | null;
  lightspeedEndDate: string | null;
  liftoffStatus: string | null;
  liftoffStartDate: string | null;
  liftoffEndDate: string | null;
};

export function parseOutcomesRow(raw: string[]): OutcomesRow | null {
  const studentNumber = raw[0]?.trim();
  if (!studentNumber) return null;

  return {
    studentNumber,
    foundationsStatus: str(raw[3]),
    foundationsStartDate: parseDate(raw[4]),
    foundationsEndDate: parseDate(raw[5]),
    phase101Status: str(raw[6]),
    phase101StartDate: parseDate(raw[7]),
    phase101EndDate: parseDate(raw[8]),
    lightspeedStatus: str(raw[9]),
    lightspeedStartDate: parseDate(raw[10]),
    lightspeedEndDate: parseDate(raw[11]),
    liftoffStatus: str(raw[12]),
    liftoffStartDate: parseDate(raw[13]),
    liftoffEndDate: parseDate(raw[14]),
  };
}

// ---------------------------------------------------------------------------
// Employment row → typed record (V2 sheet, "Employment" tab)
// Columns: studentNumber, studentName, employerName, employmentType, jobTitle,
//   startDate, endDate, hourlyWage, weeklyHours, totalEarned, exitCode, Notes
// Exit codes: E0, E1.1..E1.4, E2.1, E2.2, E3, E4, E5 (stored verbatim).
// ---------------------------------------------------------------------------

export type EmploymentRow = {
  studentNumber: string;
  studentName: string | null;
  employerName: string | null;
  employmentType: string | null;
  jobTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  hourlyWage: string | null;
  weeklyHours: string | null;
  totalEarned: string | null;
  exitCode: string | null;
  notes: string | null;
};

export function parseEmploymentRow(raw: string[]): EmploymentRow | null {
  const get = (i: number) => raw[i]?.trim();
  const studentNumber = get(0);
  if (!studentNumber) return null;

  // Strip leading $ on currency fields before parseNum
  const cleanCurrency = (v: string | undefined): string | null =>
    parseNum(v?.replace(/[\$,]/g, ''));

  return {
    studentNumber,
    studentName:    str(get(1)),
    employerName:   str(get(2)),
    employmentType: str(get(3)),
    jobTitle:       str(get(4)),
    startDate:      parseDate(get(5)),
    endDate:        parseDate(get(6)),
    hourlyWage:     cleanCurrency(get(7)),
    weeklyHours:    parseNum(get(8)),
    totalEarned:    cleanCurrency(get(9)),
    exitCode:       str(get(10)),
    notes:          str(get(11)),
  };
}

// ---------------------------------------------------------------------------
// Postsecondary row → typed record (V2 sheet, "PostSecondary" tab)
// Columns: studentNumber, firstName, lastName, institution, institutionLength
//   (2-year/4-year), institutionType (Public/Private), enrollmentBegin,
//   enrollmentEnd, enrollmentStatus, classLevel, enrollmentMajor1,
//   enrollmentMajor2, graduated (Y/N/Yes/No/true/false), graduationDate,
//   degreeTitle, degreeMajor1, degreeMajor2, degreeMajor3.
//
// enrollmentStatus and classLevel are stored verbatim as single-letter codes.
// Use POSTSECONDARY_ENROLLMENT_STATUS_LABELS / POSTSECONDARY_CLASS_LEVEL_LABELS
// at the display layer to translate to human-readable values.
// ---------------------------------------------------------------------------

// National Student Clearinghouse enrollment status codes (verbatim).
export const POSTSECONDARY_ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  F: 'Full-time',
  Q: 'Three-quarter time',
  H: 'Half-time',
  L: 'Less than half-time',
  A: 'Leave of absence',
  W: 'Withdrawn',
  D: 'Deceased',
};

// National Student Clearinghouse class level codes (verbatim).
// Note: 'D' is overloaded — Deceased in enrollment_status, Doctoral here.
// Always interpret in the context of the column it came from.
export const POSTSECONDARY_CLASS_LEVEL_LABELS: Record<string, string> = {
  F: 'Freshman (Undergraduate)',
  S: 'Sophomore (Undergraduate)',
  J: 'Junior (Undergraduate)',
  R: 'Senior (Undergraduate)',
  C: 'Certificate (Undergraduate)',
  N: 'Unspecified (Undergraduate)',
  B: "Bachelor's (Undergraduate)",
  M: "Master's (Graduate)",
  D: 'Doctoral (Graduate)',
  P: 'Postdoctorate (Graduate)',
  L: 'First Professional (Graduate)',
  G: 'Unspecified (Graduate/Professional)',
  A: "Associate's",
  T: 'Post Baccalaureate Certificate',
};


export type PostsecondaryRow = {
  studentNumber: string;
  firstName: string | null;
  lastName: string | null;
  institution: string | null;
  institutionLength: string | null;
  institutionType: string | null;
  enrollmentBegin: string | null;
  enrollmentEnd: string | null;
  enrollmentStatus: string | null;
  classLevel: string | null;
  enrollmentMajor1: string | null;
  enrollmentMajor2: string | null;
  graduated: boolean | null;
  graduationDate: string | null;
  degreeTitle: string | null;
  degreeMajor1: string | null;
  degreeMajor2: string | null;
  degreeMajor3: string | null;
};

export function parsePostsecondaryRow(raw: string[]): PostsecondaryRow | null {
  const get = (i: number) => raw[i]?.trim();
  const studentNumber = get(0);
  if (!studentNumber) return null;

  return {
    studentNumber,
    firstName:        str(get(1)),
    lastName:         str(get(2)),
    institution:      str(get(3)),
    institutionLength: str(get(4)),
    institutionType:  str(get(5)),
    enrollmentBegin:  parseDate(get(6)),
    enrollmentEnd:    parseDate(get(7)),
    enrollmentStatus: str(get(8)),
    classLevel:       str(get(9)),
    enrollmentMajor1: str(get(10)),
    enrollmentMajor2: str(get(11)),
    graduated:        parseBool(get(12)),
    graduationDate:   parseDate(get(13)),
    degreeTitle:      str(get(14)),
    degreeMajor1:     str(get(15)),
    degreeMajor2:     str(get(16)),
    degreeMajor3:     str(get(17)),
  };
}
