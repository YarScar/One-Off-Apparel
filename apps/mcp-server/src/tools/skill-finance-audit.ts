import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, parseStr, flattenMessages } from '../tool-helpers.js';
import {
  financeAuditArgsSchema,
  buildFinanceAuditMessages,
} from '../prompts/finance-audit.js';

const NAME = 'skill_finance_audit';

const DESCRIPTION =
  'Skill: Finance & Audit Readiness. Call this tool to generate multi-view financial ' +
  'reports: monthly close, audit prep packages, funder-specific spend reports, board ' +
  'financials, fund reconciliation, or custom financial queries. Returns structured ' +
  'instructions to gather live financial data and produce audit-ready output. ' +
  'IMPORTANT: After receiving the instructions, follow them step by step.';

export function registerSkillFinanceAudit(server: McpServer): void {
  server.registerTool(
    NAME,
    { description: DESCRIPTION, inputSchema: financeAuditArgsSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;
        const args = {
          report_type: parseStr(raw, 'report_type') ?? 'monthly_close',
          period: parseStr(raw, 'period'),
          funder_name: parseStr(raw, 'funder_name'),
          fund_name: parseStr(raw, 'fund_name'),
          custom_question: parseStr(raw, 'custom_question'),
          comparison_period: parseStr(raw, 'comparison_period'),
          additional_context: parseStr(raw, 'additional_context'),
        };

        const result = buildFinanceAuditMessages(args);
        const instructions = flattenMessages(result.messages);

        return {
          skill: NAME,
          note:
            'Follow the instructions below step by step. Call the MCP data tools as directed, ' +
            'gather real financial data, then produce the report. Flag all discrepancies. ' +
            'Do NOT fabricate any financial figures.',
          instructions,
        };
      }),
  );
}
