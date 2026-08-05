import { describe, expect, it } from 'vitest';

import { FINANCE_QUERY_TYPES, FINANCE_TAB_MAP } from '../tools/query-finances.js';

const { QUERY_TYPE_TO_TABS, QUERY_TYPE_TO_TAB_PREFIX, UNBACKED_QUERY_TYPES } = FINANCE_TAB_MAP;

/**
 * These tests exist because query_finances failed silently for eleven of its
 * query types: the tab names in the lookup map were Title Case while the sheet
 * connectors write them lower case, and Postgres string equality is case
 * sensitive. Every affected call returned `record_count: 0` and read as "the
 * organization has no data for this", which is the worst possible failure mode
 * for a tool whose output ends up in grant applications.
 */
describe('query_finances tab map', () => {
  it('resolves every query_type to a tab, a prefix, or an explicit explanation', () => {
    const unresolved = FINANCE_QUERY_TYPES.filter(
      (qt) =>
        !QUERY_TYPE_TO_TABS[qt] && !QUERY_TYPE_TO_TAB_PREFIX[qt] && !UNBACKED_QUERY_TYPES[qt],
    );
    expect(unresolved).toEqual([]);
  });

  it('gives every query_type a tab name that is not just the query_type echoed back', () => {
    // Resolving only to `tabName === queryType` is the shape the budget_actuals bug
    // had: no connector writes such a tab, so the result is always empty. Seed
    // aliases like 'ytd' and 'fund_balances' are allowed alongside a real tab name.
    for (const [queryType, tabs] of Object.entries(QUERY_TYPE_TO_TABS)) {
      expect(
        tabs.some((tab) => tab !== queryType),
        `${queryType} resolves only to its own name`,
      ).toBe(true);
    }
  });

  it('keeps development tab names lower case, matching sync-development-crm', () => {
    // connectors/google-sheets/src/sync-development-crm.ts writes
    // `development:grants tracker`, `development:giving history`, and so on.
    const devTabs = Object.entries(QUERY_TYPE_TO_TABS)
      .filter(([queryType]) => queryType.startsWith('dev_'))
      .flatMap(([, tabs]) => tabs);

    expect(devTabs.length).toBeGreaterThan(0);
    for (const tab of devTabs) {
      expect(tab).toBe(tab.toLowerCase());
      expect(tab.startsWith('development:')).toBe(true);
    }
  });

  it('keeps phase_dashboard tab names lower case, matching sync-phase-budget-dashboard', () => {
    const phaseTabs = Object.entries(QUERY_TYPE_TO_TABS)
      .filter(([queryType]) => queryType.startsWith('phase_budget_'))
      .flatMap(([, tabs]) => tabs);

    expect(phaseTabs.length).toBeGreaterThan(0);
    for (const tab of phaseTabs) {
      expect(tab).toBe(tab.toLowerCase());
    }
  });

  it('maps fund_balances to the dashboard sync tab, not only the seed alias', () => {
    // sync-dashboard.ts writes 'Combined Funds'; 'fund_balances' is what seed.ts uses.
    expect(QUERY_TYPE_TO_TABS['fund_balances']).toContain('Combined Funds');
  });

  it('declares no tab name more than once across query types', () => {
    const seen = new Map<string, string>();
    for (const [queryType, tabs] of Object.entries(QUERY_TYPE_TO_TABS)) {
      for (const tab of tabs) {
        const key = tab.toLowerCase();
        const prior = seen.get(key);
        expect(prior, `${tab} is claimed by both ${prior} and ${queryType}`).toBeUndefined();
        seen.set(key, queryType);
      }
    }
  });
});
