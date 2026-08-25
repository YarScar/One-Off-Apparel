import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, parseStr, READ_ONLY_ANNOTATIONS, flattenMessages } from '../tool-helpers.js';
import {
  grantProspectingArgsSchema,
  buildGrantProspectingMessages,
} from '../prompts/grant-prospecting.js';

const NAME = 'skill_grant_prospecting';

const DESCRIPTION =
  'Skill: Grant Prospecting. Call this tool to get structured instructions for ' +
  'finding funders whose giving history and priorities align with the organization. ' +
  'Returns a step-by-step workflow: build an org profile from live data, research peer ' +
  'organizations and their funders, check board connections, score prospects, and produce ' +
  'a ranked list with deadline calendar. IMPORTANT: After receiving the instructions, ' +
  'follow them step by step — call the MCP data tools as directed, do web research, ' +
  'and pause at each checkpoint to ask the user for input.';

export function registerSkillGrantProspecting(server: McpServer): void {
  server.registerTool(
    NAME,
    { description: DESCRIPTION, inputSchema: grantProspectingArgsSchema, annotations: READ_ONLY_ANNOTATIONS },
    (input) =>
      runTool(NAME, input, async () => {
        const raw = input as Record<string, unknown>;
        const args = {
          funding_need: parseStr(raw, 'funding_need') ?? '',
          program_details: parseStr(raw, 'program_details'),
          grant_size_range: parseStr(raw, 'grant_size_range'),
          grant_type: parseStr(raw, 'grant_type'),
          organization_location: parseStr(raw, 'organization_location'),
          regional_preference: parseStr(raw, 'regional_preference'),
          peer_organizations: parseStr(raw, 'peer_organizations'),
          board_members: parseStr(raw, 'board_members'),
          scoring_weights: parseStr(raw, 'scoring_weights'),
          exclude_current_funders:
            typeof raw['exclude_current_funders'] === 'boolean'
              ? (raw['exclude_current_funders'] as boolean)
              : undefined,
          additional_context: parseStr(raw, 'additional_context'),
        };

        const result = buildGrantProspectingMessages(args);
        const instructions = flattenMessages(result.messages);

        return {
          skill: NAME,
          note:
            'Follow the instructions below step by step. Call the MCP data tools as directed, ' +
            'do web research as instructed, and PAUSE at each CHECKPOINT to ask the user for input. ' +
            'Do NOT skip checkpoints.',
          instructions,
        };
      }),
  );
}
