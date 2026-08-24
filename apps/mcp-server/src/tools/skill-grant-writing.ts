import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, parseStr } from '../tool-helpers.js';
import {
  grantWritingArgsSchema,
  buildGrantWritingMessages,
} from '../prompts/grant-writing.js';

const NAME = 'skill_grant_writing';

const DESCRIPTION =
  'Skill: Grant Writing & Reporting. Call this tool to get structured instructions for ' +
  'assembling a grant proposal or funder report from live organizational data. ' +
  'Accepts a URL to scrape grant requirements or pasted text. Returns a step-by-step ' +
  'workflow: research the funder, gather internal data via MCP tools, then draft in the ' +
  'organization\'s voice with real numbers. IMPORTANT: After receiving the instructions, ' +
  'follow them step by step — call the MCP data tools as directed, then write the draft. ' +
  'If `grant_build_draft`, `grant_match_question`, `grant_resize_answer`, and ' +
  '`grant_verify_figure` are registered, prefer that deterministic pipeline for drafting ' +
  'against a captured funder form — use this tool only as a fallback when they are not available.';

export function registerSkillGrantWriting(server: McpServer): void {
  server.registerTool(
    NAME,
    { description: DESCRIPTION, inputSchema: grantWritingArgsSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;
        const args = {
          task_type: parseStr(raw, 'task_type') ?? 'proposal',
          grant_requirements: parseStr(raw, 'grant_requirements'),
          grant_url: parseStr(raw, 'grant_url'),
          funder_name: parseStr(raw, 'funder_name'),
          submission_format: parseStr(raw, 'submission_format'),
          program_area: parseStr(raw, 'program_area'),
          grant_focus: parseStr(raw, 'grant_focus'),
          time_period: parseStr(raw, 'time_period'),
          additional_context: parseStr(raw, 'additional_context'),
        };

        const result = buildGrantWritingMessages(args);
        const instructions = result.messages
          .map((m) => {
            const text =
              typeof m.content === 'string'
                ? m.content
                : m.content.type === 'text'
                  ? m.content.text
                  : '';
            return `[${m.role.toUpperCase()}]\n${text}`;
          })
          .join('\n\n---\n\n');

        return {
          skill: NAME,
          note:
            'Follow the instructions below step by step. Call the MCP data tools as directed, ' +
            'gather real data, then write the draft. Do NOT skip any steps.',
          instructions,
        };
      }),
  );
}
