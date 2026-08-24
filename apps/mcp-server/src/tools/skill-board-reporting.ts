import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, parseStr, flattenMessages } from '../tool-helpers.js';
import {
  boardReportingArgsSchema,
  buildBoardReportingMessages,
} from '../prompts/board-reporting.js';

const NAME = 'skill_board_reporting';

const DESCRIPTION =
  'Skill: KPIs, Dashboards & Board Reporting. Call this tool to generate board packets, ' +
  'KPI scorecards, program updates, fundraising reports, or ED reports from live data. ' +
  'Outputs CSV for data tables and structured narrative for presentations. ' +
  'IMPORTANT: After receiving the instructions, follow them step by step — call the ' +
  'MCP data tools as directed, then produce the report.';

export function registerSkillBoardReporting(server: McpServer): void {
  server.registerTool(
    NAME,
    { description: DESCRIPTION, inputSchema: boardReportingArgsSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;
        const args = {
          report_type: parseStr(raw, 'report_type') ?? 'full_board_packet',
          meeting_date: parseStr(raw, 'meeting_date'),
          period: parseStr(raw, 'period'),
          comparison_period: parseStr(raw, 'comparison_period'),
          kpi_targets: parseStr(raw, 'kpi_targets'),
          committee: parseStr(raw, 'committee'),
          presentation_template: parseStr(raw, 'presentation_template'),
          graph_preferences: parseStr(raw, 'graph_preferences'),
          key_metrics: parseStr(raw, 'key_metrics'),
          audience_notes: parseStr(raw, 'audience_notes'),
          additional_context: parseStr(raw, 'additional_context'),
        };

        const result = buildBoardReportingMessages(args);
        const instructions = flattenMessages(result.messages);

        return {
          skill: NAME,
          note:
            'Follow the instructions below step by step. Call the MCP data tools as directed, ' +
            'gather real data, then produce the board report. Data tables as CSV, narrative as text. ' +
            'Do NOT fabricate any figures.',
          instructions,
        };
      }),
  );
}
