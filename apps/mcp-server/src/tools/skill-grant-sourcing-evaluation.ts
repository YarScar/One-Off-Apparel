import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, parseStr, parseNum, READ_ONLY_ANNOTATIONS, flattenMessages } from '../tool-helpers.js';
import {
  grantSourcingEvaluationArgsSchema,
  buildGrantSourcingEvaluationMessages,
} from '../prompts/grant-sourcing-evaluation.js';

const NAME = 'skill_grant_sourcing_evaluation';

const DESCRIPTION =
  'Skill: Grant Sourcing & Evaluation. Call this tool to get structured instructions for discovering, ' +
  'researching, evaluating, and prioritizing grant opportunities using a deterministic weighted scoring ' +
  'rubric. Use whenever the user asks to find grants, research funders, build a prospect list, score ' +
  'opportunities, or evaluate fit — even a bare "find some grants for us" or "is this funder a good fit?". ' +
  'Returns a workflow: source opportunities across five funder categories, score each on a fixed weighted ' +
  'rubric, classify priority, present a ranked table, and produce a downloadable spreadsheet and PDF of the ' +
  'same report. IMPORTANT: After receiving the instructions, follow them immediately — search for external ' +
  'grants, present them in the structured scoring table, and generate the spreadsheet/PDF outputs, without ' +
  'pausing or spending output on internal program discussion.';

export function registerSkillGrantSourcingEvaluation(server: McpServer): void {
  server.registerTool(
    NAME,
    { description: DESCRIPTION, inputSchema: grantSourcingEvaluationArgsSchema, annotations: READ_ONLY_ANNOTATIONS },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;
        const args = {
          funding_need: parseStr(raw, 'funding_need'),
          program_focus: parseStr(raw, 'program_focus'),
          grant_size_range: parseStr(raw, 'grant_size_range'),
          organization_location: parseStr(raw, 'organization_location'),
          exclude_current_funders:
            typeof raw['exclude_current_funders'] === 'boolean'
              ? (raw['exclude_current_funders'] as boolean)
              : undefined,
          max_results: parseNum(raw, 'max_results'),
          additional_context: parseStr(raw, 'additional_context'),
        };

        const result = buildGrantSourcingEvaluationMessages(args);
        const instructions = flattenMessages(result.messages);

        return {
          skill: NAME,
          note:
            'Follow the instructions below immediately. Do NOT pause for confirmation — search for external ' +
            'grants, present them in the structured scoring table, and produce the downloadable spreadsheet ' +
            'and PDF called for in Step 5. Use internal MCP data tools quietly to inform scoring, but do not ' +
            'narrate that internal context.',
          instructions,
        };
      }),
  );
}
