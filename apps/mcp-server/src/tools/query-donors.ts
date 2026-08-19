import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, parseStr, parseNum } from '../tool-helpers.js';
import { toolError } from '../errors.js';
import {
  DEV_TABS,
  cell,
  donorNameOf,
  isLaunchpad,
  nameMatches,
  parseMoney,
  readDevTab,
  rowsForDonor,
  summariseGiving,
  type DevRow,
} from '../dev-crm.js';

const NAME = 'query_donors';

const DESCRIPTION =
  "Look up Building21 donors and donor relationships from the Development CRM. Use for questions about specific donors ('what has Vanguard given'), donor population breakdowns ('how many active foundations'), or pulling a complete donor profile (gifts, grants tracker, pipeline, prior declines). Defaults to Launchpad-only scope — set launchpad_only=false for all B21 development data; the scope changes every total, so the response always states which one it used. Giving totals are summed from individual gift rows, not read from the Contacts tab's precomputed columns, which are wrong at source. For raw tab rows or aggregate finance views, use query_finances with the dev_* query types.";

const inputSchema = {
  query_type: z.enum(['list', 'profile', 'summary']),
  donor_name: z.string().optional(),
  donor_type: z.string().optional().describe('Substring match against the donor type COA, e.g. "Foundations".'),
  status: z.string().optional().describe('Substring match against CRM status, e.g. "Active", "Prospect".'),
  launchpad_only: z.boolean().optional().describe('Default true. False widens to all Building 21 scope.'),
  limit: z.number().optional(),
};

/** Filter a tab's rows to the requested scope. */
function scoped(rows: readonly DevRow[], tabName: string, launchpadOnly: boolean): DevRow[] {
  return launchpadOnly ? rows.filter((r) => isLaunchpad(r, tabName)) : [...rows];
}

export function registerQueryDonors(server: McpServer): void {
  server.registerTool(NAME, { description: DESCRIPTION, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, (input) =>
    runTool(NAME, input, async () => {
      const raw = input as Record<string, unknown>;
      const queryType = parseStr(raw, 'query_type') ?? 'list';
      const donorName = parseStr(raw, 'donor_name');
      const donorType = parseStr(raw, 'donor_type');
      const status = parseStr(raw, 'status');
      // Documented as defaulting to Launchpad-only since this tool shipped. The previous
      // implementation accepted the flag and never read it, so every response was all-B21 scope
      // while the description promised otherwise. #306.
      const launchpadOnly = raw['launchpad_only'] === undefined ? true : raw['launchpad_only'] !== false;
      const limit = parseNum(raw, 'limit') ?? 500;

      const scopeNote = launchpadOnly
        ? 'Launchpad-scoped: rows whose project column names Launchpad. Totals exclude the same donor’s gifts to other Building 21 projects.'
        : 'All Building 21 scope. A total here may include projects other than Launchpad.';

      const contacts = scoped(await readDevTab(DEV_TABS.contacts), DEV_TABS.contacts, launchpadOnly);

      if (queryType === 'summary') {
        const gifts = scoped(
          await readDevTab(DEV_TABS.givingHistory),
          DEV_TABS.givingHistory,
          launchpadOnly,
        );
        const giving = summariseGiving(gifts);
        return {
          query_type: 'summary',
          scope: launchpadOnly ? 'launchpad_only' : 'all_building21',
          scope_note: scopeNote,
          total_donors: contacts.length,
          lifetime_giving: {
            total: giving.total,
            contributing_gifts: giving.gift_count,
            by_fiscal_year: giving.by_fiscal_year,
            ...(giving.amounts_unparseable > 0
              ? {
                  amounts_unparseable: giving.amounts_unparseable,
                  amounts_unparseable_note:
                    `${giving.amounts_unparseable} gift row(s) had no parseable gross_amount and are ` +
                    'excluded from the total rather than counted as zero. The total is therefore a ' +
                    'lower bound.',
                }
              : {}),
          },
          source: 'Summed from development:giving history. NOT the Contacts tab lifetime_giving column, which is wrong at source.',
        };
      }

      if (queryType === 'profile') {
        if (!donorName) {
          return toolError('entity_not_found', 'donor_name is required for profile.');
        }
        const matches = contacts.filter((c) => nameMatches(c, donorName));
        if (matches.length === 0) {
          // Distinguish "not in this scope" from "not in the CRM at all". Under launchpad_only the
          // former is common and the caller can act on it; conflating them reproduces the exact
          // ambiguity that made the old empty-table `no_records` misleading.
          const allContacts = await readDevTab(DEV_TABS.contacts);
          if (launchpadOnly && allContacts.some((c) => nameMatches(c, donorName))) {
            return toolError(
              'no_records',
              `'${donorName}' is in the Development CRM but has no Launchpad-scoped row. Retry with launchpad_only=false to see their Building 21 record.`,
            );
          }
          // A funder can appear on the gift, pipeline or denied tabs with no Contacts row at all —
          // the Contacts tab is a stewardship roster, not the set of everyone we have asked. Bailing
          // out here would hide a prior decline, which is the single most framing-relevant thing this
          // tool can report. So fall through to a profile with no contact record rather than a
          // no_records that is false.
          const [gifts, pipeline, declines] = await Promise.all([
            readDevTab(DEV_TABS.givingHistory).then((r) => r.filter((x) => nameMatches(x, donorName))),
            readDevTab(DEV_TABS.prospectPipeline).then((r) => r.filter((x) => nameMatches(x, donorName))),
            readDevTab(DEV_TABS.denied).then((r) => r.filter((x) => nameMatches(x, donorName))),
          ]);
          if (gifts.length === 0 && pipeline.length === 0 && declines.length === 0) {
            return toolError(
              'no_records',
              `No donor matched '${donorName}' in development:contacts (${allContacts.length} rows searched), nor on the giving history, prospect pipeline or denied tabs.`,
            );
          }
          const giving = summariseGiving(gifts);
          return {
            query_type: 'profile',
            scope: launchpadOnly ? 'launchpad_only' : 'all_building21',
            scope_note: scopeNote,
            matched_name: donorNameOf(gifts[0] ?? pipeline[0] ?? declines[0] ?? { sourceId: '', data: {} }) ?? donorName,
            contact_id: null,
            profile: null,
            profile_note:
              'No development:contacts row for this name — they appear only on the transaction tabs. ' +
              'Expect no program officer, relationship owner or Drive link. Everything below is real.',
            giving_summary: {
              total: giving.total,
              gift_count: giving.gift_count,
              by_fiscal_year: giving.by_fiscal_year,
              by_project: giving.by_project,
            },
            giving_history: gifts.map((g) => ({
              gift_id: cell(g, 'gift_id'),
              date: cell(g, 'date'),
              fiscal_year: cell(g, 'fiscal_year'),
              gross_amount: parseMoney(g.data['gross_amount']),
              fund: cell(g, 'fund_name'),
              project: cell(g, 'project'),
              grant_status: cell(g, 'grant_status'),
            })),
            grants_tracker: [],
            prospect_pipeline: pipeline.map((p) => ({
              prospect_id: cell(p, 'prospect_id'),
              month: cell(p, 'month'),
              fiscal_year: cell(p, 'fiscal_year'),
              fund: cell(p, 'fund_name'),
              project: cell(p, 'project'),
              grant_status: cell(p, 'grant_status'),
              gross_amount: parseMoney(p.data['gross_amount']),
            })),
            launchpad_pipeline: [],
            prior_declines: declines.map((d) => ({
              month: cell(d, 'month'),
              fiscal_year: cell(d, 'fiscal_year'),
              fund: cell(d, 'fund_name'),
              project: cell(d, 'project'),
              asked: parseMoney(d.data['gross_amount']),
              notes: cell(d, 'notes'),
            })),
            ...(declines.length > 0
              ? {
                  prior_declines_note:
                    'This funder has declined a prior request. A first-approach framing would be wrong.',
                }
              : {}),
          };
        }
        if (matches.length > 1) {
          return {
            query_type: 'profile',
            ambiguous: true,
            scope: launchpadOnly ? 'launchpad_only' : 'all_building21',
            candidates: matches.slice(0, 10).map((m) => ({
              contact_id: cell(m, 'contact_id'),
              donor_name: donorNameOf(m),
              donor_type: cell(m, 'donor_type_coa'),
              status: cell(m, 'status'),
              projects: cell(m, 'projects'),
              primary_fund: cell(m, 'primary_fund'),
            })),
            note: 'Narrow donor_name. A CRM fund can share a funder’s name, so a broad string matches more than one organisation.',
          };
        }

        const [donor] = matches;
        if (!donor) {
          return toolError('no_records', `No donor matched '${donorName}'.`);
        }
        const contactId = cell(donor, 'contact_id');
        const resolvedName = donorNameOf(donor);

        const [historyAll, trackerAll, pipelineAll, launchpadPipelineAll, deniedAll] =
          await Promise.all([
            readDevTab(DEV_TABS.givingHistory),
            readDevTab(DEV_TABS.grantsTracker),
            readDevTab(DEV_TABS.prospectPipeline),
            readDevTab(DEV_TABS.launchpadPipeline),
            readDevTab(DEV_TABS.denied),
          ]);

        const gifts = rowsForDonor(
          scoped(historyAll, DEV_TABS.givingHistory, launchpadOnly),
          contactId,
          resolvedName,
        );
        const grants = rowsForDonor(
          scoped(trackerAll, DEV_TABS.grantsTracker, launchpadOnly),
          contactId,
          resolvedName,
        );
        const pipeline = rowsForDonor(
          scoped(pipelineAll, DEV_TABS.prospectPipeline, launchpadOnly),
          contactId,
          resolvedName,
        );
        // No contact_id column on this tab; name is the only join available.
        const launchpadPipeline = launchpadPipelineAll.filter(
          (r) => resolvedName !== null && nameMatches(r, resolvedName),
        );
        const denied = rowsForDonor(
          scoped(deniedAll, DEV_TABS.denied, launchpadOnly),
          contactId,
          resolvedName,
        );

        const giving = summariseGiving(gifts);

        return {
          query_type: 'profile',
          scope: launchpadOnly ? 'launchpad_only' : 'all_building21',
          scope_note: scopeNote,
          matched_name: resolvedName,
          contact_id: contactId,
          profile: {
            donor_name: resolvedName,
            donor_type: cell(donor, 'donor_type_coa'),
            status: cell(donor, 'status'),
            projects: cell(donor, 'projects'),
            primary_fund: cell(donor, 'primary_fund'),
            primary_contact: [cell(donor, 'primary_first_name'), cell(donor, 'primary_last_name')]
              .filter(Boolean)
              .join(' ') || null,
            primary_email: cell(donor, 'primary_email'),
            secondary_email: cell(donor, 'secondary_email'),
            phone: cell(donor, 'phone'),
            relationship_owner: cell(donor, 'relationship_owner'),
            relationship_notes: cell(donor, 'relationship_notes'),
            drive_folder_link: cell(donor, 'drive_folder_link'),
            date_of_last_gift: cell(donor, 'date_of_last_gift'),
          },
          giving_summary: {
            total: giving.total,
            gift_count: giving.gift_count,
            by_fiscal_year: giving.by_fiscal_year,
            by_project: giving.by_project,
            ...(giving.amounts_unparseable > 0
              ? { amounts_unparseable: giving.amounts_unparseable }
              : {}),
            source:
              'Summed from development:giving history gift rows. The Contacts tab’s lifetime_giving / ' +
              'fy25_giving / fy26_giving columns are wrong at source and are deliberately not read — ' +
              'see the by_project split before quoting any single total to a funder.',
          },
          giving_history: gifts.map((g) => ({
            gift_id: cell(g, 'gift_id'),
            date: cell(g, 'date'),
            fiscal_year: cell(g, 'fiscal_year'),
            gross_amount: parseMoney(g.data['gross_amount']),
            fund: cell(g, 'fund_name'),
            project: cell(g, 'project'),
            grant_status: cell(g, 'grant_status'),
            notes: cell(g, 'notes'),
          })),
          grants_tracker: grants.map((t) => ({
            funder: cell(t, 'funder'),
            status: cell(t, 'status'),
            lifecycle: cell(t, 'lifecycle'),
            lifetime_total: parseMoney(t.data['lifetime_total']),
            received_to_date: parseMoney(t.data['received_to_date']),
            outstanding_pledge: parseMoney(t.data['outstanding_pledge']),
            unfunded_pledges: parseMoney(t.data['unfunded_pledges']),
            funds: cell(t, 'fund_s'),
            projects: cell(t, 'project_s'),
            program_officer: cell(t, 'po_contact'),
            period_start: cell(t, 'period_start'),
            period_end: cell(t, 'period_end'),
            restrictions: cell(t, 'restrictions'),
          })),
          prospect_pipeline: pipeline.map((p) => ({
            prospect_id: cell(p, 'prospect_id'),
            month: cell(p, 'month'),
            fiscal_year: cell(p, 'fiscal_year'),
            fund: cell(p, 'fund_name'),
            project: cell(p, 'project'),
            grant_status: cell(p, 'grant_status'),
            gross_amount: parseMoney(p.data['gross_amount']),
            projected_amount: parseMoney(p.data['projected_amt']),
            weighted: cell(p, 'weighted'),
            owner: cell(p, 'owner'),
            next_action: cell(p, 'next_action'),
          })),
          launchpad_pipeline: launchpadPipeline.map((p) => ({
            prospect_id: cell(p, 'prospect_id'),
            fiscal_year: cell(p, 'fy'),
            month: cell(p, 'month'),
            fund: cell(p, 'fund'),
            status: cell(p, 'status'),
            ask_amount: parseMoney(p.data['ask_amount']),
            projected_amount: parseMoney(p.data['projected_amt']),
            probability: cell(p, 'probability'),
            owner: cell(p, 'owner'),
            next_action: cell(p, 'next_action'),
          })),
          prior_declines: denied.map((d) => ({
            month: cell(d, 'month'),
            fiscal_year: cell(d, 'fiscal_year'),
            fund: cell(d, 'fund_name'),
            project: cell(d, 'project'),
            asked: parseMoney(d.data['gross_amount']),
            notes: cell(d, 'notes'),
          })),
          ...(denied.length > 0
            ? {
                prior_declines_note:
                  'This funder has declined a prior request. A first-approach framing would be wrong.',
              }
            : {}),
        };
      }

      // list
      let rows = contacts;
      if (donorName) rows = rows.filter((c) => nameMatches(c, donorName));
      if (donorType) {
        const q = donorType.toLowerCase();
        rows = rows.filter((c) => (cell(c, 'donor_type_coa') ?? '').toLowerCase().includes(q));
      }
      if (status) {
        const q = status.toLowerCase();
        rows = rows.filter((c) => (cell(c, 'status') ?? '').toLowerCase().includes(q));
      }
      const total = rows.length;
      const page = rows.slice(0, limit);
      return {
        query_type: 'list',
        scope: launchpadOnly ? 'launchpad_only' : 'all_building21',
        scope_note: scopeNote,
        record_count: page.length,
        total_matching: total,
        truncated: total > page.length,
        donors: page.map((d) => ({
          contact_id: cell(d, 'contact_id'),
          donor_name: donorNameOf(d),
          donor_type: cell(d, 'donor_type_coa'),
          status: cell(d, 'status'),
          projects: cell(d, 'projects'),
          primary_fund: cell(d, 'primary_fund'),
          primary_email: cell(d, 'primary_email'),
          relationship_owner: cell(d, 'relationship_owner'),
        })),
      };
    }),
  );
}
