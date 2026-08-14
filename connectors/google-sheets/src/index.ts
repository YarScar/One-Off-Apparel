import { runSync, type SyncRunRecord } from '@lp-ai/lib-db';
import { syncStudents, syncOutcomes, syncCertifications } from './sync-students.js';
import { syncEmployment } from './sync-employment.js';
import { syncPostsecondary } from './sync-postsecondary.js';
import { syncRapid } from './sync-rapid.js';
import { syncPex } from './sync-pex.js';
import { syncDevelopmentCRM } from './sync-development-crm.js';
import { syncDistances } from './sync-distances.js';
import { syncDashboard } from './sync-dashboard.js';
import { syncPhaseBudgetDashboard } from './sync-phase-budget-dashboard.js';
import { syncPhaseActualsQ3_2026, syncPhaseActuals2025 } from './sync-phase-dashboard.js';
import { syncStudentCompetency } from './sync-student-competency.js';
import { syncAttendance } from './sync-attendance.js';
import { syncEnrollment } from './sync-enrollment.js';

export type SyncResult = SyncRunRecord;

async function safeRun(label: string, fn: () => Promise<number>): Promise<number> {
  try {
    const n = await fn();
    console.log(`google-sheets: ${label} — ${n} rows`);
    return n;
  } catch (err) {
    console.error(`google-sheets: ${label} FAILED —`, err instanceof Error ? err.message : String(err));
    return 0;
  }
}

export async function sync(): Promise<SyncResult> {
  return runSync('google-sheets', async () => {
    const students = await safeRun('students', syncStudents);
    const outcomes = await safeRun('outcomes', syncOutcomes);
    const employment = await safeRun('employment', syncEmployment);
    const postsecondary = await safeRun('postsecondary', syncPostsecondary);
    const certifications = await safeRun('certifications', syncCertifications);
    const dashboard = await safeRun('dashboard', syncDashboard);
    const phaseBudget = await safeRun('phase budget dashboard', syncPhaseBudgetDashboard);
    const phaseQ3 = await safeRun('phase actuals Q3 2026', syncPhaseActualsQ3_2026);
    const phase2025 = await safeRun('phase actuals 2025', syncPhaseActuals2025);
    const rapid = await safeRun('rapid', syncRapid);
    const pex = await safeRun('pex', syncPex);
    const competency = await safeRun('student competency', syncStudentCompetency);
    const devCrm = await safeRun('development CRM', syncDevelopmentCRM);
    const attendance = await safeRun('attendance', syncAttendance);
    const enrollment = await safeRun('enrollment', syncEnrollment);

    let distanceUpdated = 0;
    let distanceSkipped = 0;
    try {
      const d = await syncDistances();
      distanceUpdated = d.updated;
      distanceSkipped = d.skipped;
      console.log(`google-sheets: distances — ${d.updated} updated, ${d.skipped} skipped`);
    } catch (err) {
      console.error(`google-sheets: distances FAILED —`, err instanceof Error ? err.message : String(err));
    }

    const total =
      students + outcomes + employment + postsecondary + certifications +
      dashboard + phaseBudget + phaseQ3 + phase2025 +
      rapid + pex + competency + devCrm +
      attendance + enrollment + distanceUpdated;

    return {
      status: 'ok',
      recordsUpserted: total,
      notes: `students: ${students}; outcomes: ${outcomes}; employment: ${employment}; postsecondary: ${postsecondary}; certifications: ${certifications}; dashboard: ${dashboard}; phase_budget: ${phaseBudget}; phase_q3_2026: ${phaseQ3}; phase_2025: ${phase2025}; rapid: ${rapid}; pex: ${pex}; competency: ${competency}; dev_crm: ${devCrm}; attendance: ${attendance}; enrollment: ${enrollment}; distances: ${distanceUpdated} updated / ${distanceSkipped} skipped`,
    };
  }, {
    tables: [
      'students',
      'student_phase_outcomes',
      'student_certifications',
      'student_competencies',
      'student_employment',
      'student_postsecondary',
      'attendance_records',
      'enrollment_snapshots',
      'finance_snapshots',
      'entity_aliases',
    ],
  });
}

export { syncStudents, syncOutcomes, syncCertifications } from './sync-students.js';
export { syncEmployment } from './sync-employment.js';
export { syncPostsecondary } from './sync-postsecondary.js';
export { syncRapid } from './sync-rapid.js';
export { syncPex } from './sync-pex.js';
export { syncDevelopmentCRM } from './sync-development-crm.js';
export { syncDistances } from './sync-distances.js';
export { syncDashboard } from './sync-dashboard.js';
export { syncPhaseBudgetDashboard } from './sync-phase-budget-dashboard.js';
export { syncPhaseActualsQ3_2026, syncPhaseActuals2025 } from './sync-phase-dashboard.js';
export { syncStudentCompetency } from './sync-student-competency.js';
export { syncAttendance } from './sync-attendance.js';
export { syncEnrollment } from './sync-enrollment.js';
