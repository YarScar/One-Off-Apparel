import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGetStudentInfo } from './tools/get-student-info.js';
import { registerQueryStudents } from './tools/query-students.js';
import { registerQueryOutcomes } from './tools/query-outcomes.js';
import { registerQueryEnrollment } from './tools/query-enrollment.js';
import { registerQueryCertifications } from './tools/query-certifications.js';
import { registerQueryCompetency } from './tools/query-competency.js';
import { registerQueryFinances } from './tools/query-finances.js';
import { registerQueryDonors } from './tools/query-donors.js';
import { registerQueryAttendance } from './tools/query-attendance.js';
import { registerQueryEmployment } from './tools/query-employment.js';
import { registerQueryPostsecondary } from './tools/query-postsecondary.js';
import { registerSearchConversations } from './tools/search-conversations.js';
import { registerSearchByPerson } from './tools/search-by-person.js';
import { registerGetEntityBrief } from './tools/get-entity-brief.js';
import { registerGetFinanceBrief } from './tools/get-finance-brief.js';
import { registerSearchDocuments } from './tools/search-documents.js';
import { registerFindGrantDocuments } from './tools/find-grant-documents.js';

import { registerGrantMatchQuestion } from './tools/grant-match-question.js';
import { registerGrantBuildDraft } from './tools/grant-build-draft.js';
import { registerGrantResizeAnswer } from './tools/grant-resize-answer.js';
import { registerGrantVerifyFigure } from './tools/grant-verify-figure.js';

import { registerSkillGrantWriting } from './tools/skill-grant-writing.js';
import { registerSkillGrantProspecting } from './tools/skill-grant-prospecting.js';
import { registerSkillGrantSourcingEvaluation } from './tools/skill-grant-sourcing-evaluation.js';
import { registerSkillFinanceAudit } from './tools/skill-finance-audit.js';
import { registerSkillBoardReporting } from './tools/skill-board-reporting.js';

import { registerGrantWritingPrompt } from './prompts/grant-writing.js';
import { registerGrantProspectingPrompt } from './prompts/grant-prospecting.js';
import { registerGrantSourcingEvaluationPrompt } from './prompts/grant-sourcing-evaluation.js';
import { registerFinanceAuditPrompt } from './prompts/finance-audit.js';
import { registerBoardReportingPrompt } from './prompts/board-reporting.js';

export function makeServer(): McpServer {
  const server = new McpServer({
    name: 'lp-internal-ai',
    version: '1.0.0',
  });

  // Data tools
  registerGetStudentInfo(server);
  registerQueryStudents(server);
  registerQueryOutcomes(server);
  registerQueryEnrollment(server);
  registerQueryCertifications(server);
  registerQueryCompetency(server);
  registerQueryFinances(server);
  registerQueryDonors(server);
  registerQueryAttendance(server);
  registerQueryEmployment(server);
  registerQueryPostsecondary(server);
  registerSearchConversations(server);
  registerSearchByPerson(server);
  registerGetEntityBrief(server);
  registerGetFinanceBrief(server);
  registerSearchDocuments(server);

  // Grant writing tools (deterministic; they read seed data, never the database)
  registerFindGrantDocuments(server);
  registerGrantMatchQuestion(server);
  registerGrantBuildDraft(server);
  registerGrantResizeAnswer(server);
  registerGrantVerifyFigure(server);

  // Skill tools (return structured instructions for Claude to follow)
  registerSkillGrantWriting(server);
  registerSkillGrantProspecting(server);
  registerSkillGrantSourcingEvaluation(server);
  registerSkillFinanceAudit(server);
  registerSkillBoardReporting(server);

  // Prompts (same skills, for clients that support MCP prompts)
  registerGrantWritingPrompt(server);
  registerGrantProspectingPrompt(server);
  registerGrantSourcingEvaluationPrompt(server);
  registerFinanceAuditPrompt(server);
  registerBoardReportingPrompt(server);

  return server;
}
