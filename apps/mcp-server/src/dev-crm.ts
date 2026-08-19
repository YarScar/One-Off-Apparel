/**
 * Readers for the Development CRM, which lives in `finance_snapshots` under the `development:*`
 * tab names written by `connectors/google-sheets/src/sync-development-crm.ts`.
 *
 * ## Why this module exists
 *
 * `query_donors`, `get_entity_brief`'s donor arm and `get_finance_brief.recent_gifts` used to read
 * the typed `donor_contacts` / `donor_gifts` / `donor_pipeline` tables. **No connector has ever
 * written those tables** — `packages/db/src/seed.ts` is their only writer in the repository, and
 * Givebutter, the source `schema.prisma` names on `donor_contacts.givebutter_contact_id`, has no
 * connector. So in production all three returned zero rows while their descriptions promised
 * Development CRM data.
 *
 * The failure mode was worse than an empty response. `query_donors` is *permitted*, not ACL-denied,
 * so it answered `no_records` per funder — which reads as "this funder has not given" when it meant
 * "no donor is recorded anywhere". A 2026-08-19 grant-drafting run filed `[DATA UNAVAILABLE]` for
 * four funders on exactly that misreading, with $1.6M of William Penn history live in the sheet the
 * whole time. OpenProject #306; the runbook entry it resolves is
 * `docs/runbooks/mcp-silent-empty-results.md`.
 *
 * These tabs are the same rows `query_finances`'s `dev_*` query types serve. That tool returns raw
 * `rowData` for a caller who wants to read columns; this module resolves an *entity* across six
 * tabs, which is the job the donor tools were for.
 *
 * ## Columns are discovered, not declared
 *
 * `sync-development-crm.ts` derives every key from the sheet's own header row through
 * `headerToKey()`, so a renamed column silently becomes a new key rather than an error. Every field
 * read here is therefore optional, and `parseMoney` returns `null` rather than `0` for anything it
 * cannot parse — a missing amount must never enter a total as a zero.
 */

import { prisma } from '@lp-ai/lib-db';

/** Tab names, copied from the connector that writes them. Postgres equality is case sensitive. */
export const DEV_TABS = {
  contacts: 'development:contacts',
  givingHistory: 'development:giving history',
  grantsTracker: 'development:grants tracker',
  prospectPipeline: 'development:prospect pipeline',
  launchpadPipeline: 'development:launchpad pipeline',
  denied: 'development:denied',
} as const;

/**
 * The grants tracker carries a literal `[VP]` in cells that are deliberately withheld, and
 * `NOT YET MARKED` in `gh_grant_agree`. Neither is a value. Returning them verbatim would put the
 * string "[VP]" into a funder-facing draft as if it were a deadline or a program officer.
 */
const PLACEHOLDERS = new Set(['[vp]', 'not yet marked', 'n/a', 'na', '-', '—', 'tbd']);

export interface DevRow {
  readonly sourceId: string;
  readonly data: Record<string, string>;
}

/** A cell's value, or null when absent or a withheld placeholder. */
export function cell(row: DevRow, key: string): string | null {
  const raw = row.data[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Parse a sheet money cell to a number. Handles `$1,600,000.00`, `$20,087`, a bare `20000`, and
 * accounting negatives `($500.00)`. Returns **null**, never 0, when there is no parseable figure:
 * these values are summed, and a blank cell entering a total as a zero is how a partial sum comes
 * to look like a complete one.
 */
export function parseMoney(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  const negative = /^\(.*\)$/.test(trimmed);
  const digits = trimmed.replace(/[()$,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(digits)) return null;
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Sum money cells, ignoring unparseable ones but reporting how many were skipped. */
export function sumMoney(
  rows: readonly DevRow[],
  key: string,
): { readonly total: number; readonly counted: number; readonly unparseable: number } {
  let total = 0;
  let counted = 0;
  let unparseable = 0;
  for (const row of rows) {
    const value = parseMoney(row.data[key]);
    if (value === null) {
      unparseable += 1;
      continue;
    }
    total += value;
    counted += 1;
  }
  return { total, counted, unparseable };
}

/**
 * A row is blank when every cell is empty or a placeholder. The sheets carry trailing empty rows
 * that still produce a `finance_snapshots` row, because `gh_grant_agree` defaults to the literal
 * `NOT YET MARKED` and so the row is not all-empty by the connector's test.
 */
function isBlank(row: DevRow): boolean {
  return Object.keys(row.data).every((key) => cell(row, key) === null);
}

/** Read one development tab, dropping blank rows. */
export async function readDevTab(tabName: string): Promise<DevRow[]> {
  const rows = await prisma.financeSnapshot.findMany({
    where: { tabName },
    orderBy: { sourceId: 'asc' },
  });
  return rows
    .map((r) => ({
      sourceId: r.sourceId,
      data: (r.rowData ?? {}) as Record<string, string>,
    }))
    .filter((r) => !isBlank(r));
}

/**
 * The column naming the project a row belongs to. It differs per tab — `projects` on contacts,
 * `project` on the gift and pipeline tabs, `project_s` on the grants tracker — and getting it wrong
 * silently disables `launchpad_only` rather than erroring.
 */
const PROJECT_KEY: Record<string, string> = {
  [DEV_TABS.contacts]: 'projects',
  [DEV_TABS.givingHistory]: 'project',
  [DEV_TABS.grantsTracker]: 'project_s',
  [DEV_TABS.prospectPipeline]: 'project',
  [DEV_TABS.denied]: 'project',
};

/**
 * Whether a row is in Launchpad scope.
 *
 * The project cell is multi-valued (`"Launchpad, Network"`), so this is a substring test. The
 * Launchpad Pipeline tab has no project column because every row on it is Launchpad by
 * construction — it returns true there rather than filtering everything out.
 */
export function isLaunchpad(row: DevRow, tabName: string): boolean {
  if (tabName === DEV_TABS.launchpadPipeline) return true;
  const key = PROJECT_KEY[tabName];
  if (!key) return true;
  return (cell(row, key) ?? '').toLowerCase().includes('launchpad');
}

/**
 * The columns that name a donor, per tab. The grants tracker calls it `funder`; everything else
 * calls it `donor_name`. Contacts additionally carries split person-name columns.
 *
 * Matching is confined to these columns on purpose. `query_finances`'s `contains` matches the
 * serialized rowData, so searching it for "William Penn" also returns Project Based Learning, Inc.
 * — whose `primary_fund` happens to be "William Penn". A donor lookup that reports a *different*
 * organisation's giving under the searched name is worse than one that finds nothing.
 */
const NAME_KEYS = ['donor_name', 'funder', 'primary_first_name', 'primary_last_name'] as const;

/** The best display name for a row. */
export function donorNameOf(row: DevRow): string | null {
  const direct = cell(row, 'donor_name') ?? cell(row, 'funder');
  if (direct) return direct;
  const first = cell(row, 'primary_first_name');
  const last = cell(row, 'primary_last_name');
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined || null;
}

/** Case-insensitive substring match against the name columns only. */
export function nameMatches(row: DevRow, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return false;
  return NAME_KEYS.some((key) => (cell(row, key) ?? '').toLowerCase().includes(q));
}

/**
 * Group rows by `contact_id`, the CRM's own donor key (`D-197`). It is present on contacts, giving
 * history, grants tracker and prospect pipeline, and blank on much of `denied` and absent from
 * `launchpad pipeline` — so callers must fall back to a name match for those two rather than
 * assuming the join always resolves.
 */
export function indexByContactId(rows: readonly DevRow[]): Map<string, DevRow[]> {
  const out = new Map<string, DevRow[]>();
  for (const row of rows) {
    const id = cell(row, 'contact_id');
    if (!id) continue;
    const bucket = out.get(id);
    if (bucket) bucket.push(row);
    else out.set(id, [row]);
  }
  return out;
}

/**
 * Rows belonging to one donor: by `contact_id` when the row has one, else by name. Both are needed
 * — see {@link indexByContactId}.
 */
export function rowsForDonor(
  rows: readonly DevRow[],
  contactId: string | null,
  name: string | null,
): DevRow[] {
  return rows.filter((row) => {
    const rowId = cell(row, 'contact_id');
    if (contactId && rowId) return rowId === contactId;
    return name ? nameMatches(row, name) : false;
  });
}

/**
 * Giving totalled from the gift rows themselves, per fiscal year and per project.
 *
 * **Not read from `dev_contacts`.** That tab's `lifetime_giving`, `fy25_giving` and `fy26_giving`
 * columns are wrong at source: William Penn Foundation reads `$0.00` lifetime against a
 * `$1,600,000.00` grants-tracker total, while `cy2025_giving` carries a real `$500,000.00`. The
 * columns are inconsistent rather than uniformly empty — some rows do carry a correct `fy25_giving`
 * — which makes them unusable, because a caller cannot tell a true zero from a broken one.
 *
 * Summing the gift rows also makes `launchpad_only` mean something for a total, which a
 * precomputed all-scope column could never support. That matters more than it sounds: William Penn
 * gives $500,000/yr of which **$425,000 is Launchpad** and $75,000 is Network Unrestricted, so the
 * Launchpad-scoped history is $1,375,000, not $1,600,000. Quoting the wrong one to a funder
 * misstates the relationship's size by $225,000.
 */
export function summariseGiving(gifts: readonly DevRow[]): {
  readonly total: number;
  readonly gift_count: number;
  readonly amounts_unparseable: number;
  readonly by_fiscal_year: Record<string, number>;
  readonly by_project: Record<string, number>;
  readonly first_gift: string | null;
  readonly last_gift: string | null;
} {
  const { total, counted, unparseable } = sumMoney(gifts, 'gross_amount');
  const byYear: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  for (const gift of gifts) {
    const amount = parseMoney(gift.data['gross_amount']);
    if (amount === null) continue;
    const fy = cell(gift, 'fiscal_year') ?? 'unknown';
    byYear[fy] = (byYear[fy] ?? 0) + amount;
    const project = cell(gift, 'project') ?? 'unspecified';
    byProject[project] = (byProject[project] ?? 0) + amount;
  }
  const dates = gifts.map((g) => cell(g, 'date')).filter((d): d is string => Boolean(d));
  return {
    total,
    gift_count: counted,
    amounts_unparseable: unparseable,
    by_fiscal_year: byYear,
    by_project: byProject,
    // The `date` cell is a display string ("Aug 2025"), not a sortable date, so these are the first
    // and last rows as the sheet orders them, not a computed min and max. Named accordingly.
    first_gift: dates[0] ?? null,
    last_gift: dates[dates.length - 1] ?? null,
  };
}
