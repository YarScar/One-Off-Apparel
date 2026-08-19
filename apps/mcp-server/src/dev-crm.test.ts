import { describe, it, expect } from 'vitest';

import {
  DEV_TABS,
  cell,
  donorNameOf,
  isLaunchpad,
  indexByContactId,
  nameMatches,
  parseMoney,
  rowsForDonor,
  sumMoney,
  summariseGiving,
  type DevRow,
} from './dev-crm.js';

/**
 * Fixtures copied from live `query_finances` probes on 2026-08-19, not invented. The column keys are
 * derived from sheet headers by `sync-development-crm.ts`, so a fixture written from imagination
 * would test a schema that does not exist.
 */
const row = (data: Record<string, string>, sourceId = 'development:x:1'): DevRow => ({ sourceId, data });

const WPF_CONTACT = row({
  contact_id: 'D-197',
  donor_name: 'William Penn Foundation',
  status: 'Active',
  projects: 'Launchpad, Network',
  primary_fund: 'Network Unrestricted, William Penn',
  primary_email: 'swaller@williampennfoundation.org',
  primary_first_name: 'Stephanie',
  primary_last_name: 'Waller',
  donor_type_coa: '4000.11 - Foundations',
  // The broken columns, exactly as the sheet serves them.
  lifetime_giving: '$0.00',
  fy25_giving: '$0.00',
  fy26_giving: '$0.00',
  cy2025_giving: '$500,000.00',
});

/** A different organisation whose *fund* is named "William Penn". The false-positive case. */
const PBL_CONTACT = row({
  contact_id: 'D-161',
  donor_name: 'Project Based Learning, Inc.',
  status: 'Active',
  projects: 'Philly',
  primary_fund: 'William Penn',
  donor_type_coa: '4000.11 - Foundations',
  lifetime_giving: '$102.56',
});

/** The FY24-FY26 pattern: each year split $425,000 Launchpad + $75,000 Network. */
const WPF_GIFTS: DevRow[] = [
  row({ contact_id: 'D-197', donor_name: 'William Penn Foundation', gift_id: 'G-0227', date: 'Jun 2022', fiscal_year: 'FY22', gross_amount: '$100,000.00', fund_name: 'William Penn', project: 'Launchpad', grant_status: 'Funded' }),
  row({ contact_id: 'D-197', donor_name: 'William Penn Foundation', gift_id: 'G-0331', date: 'Aug 2023', fiscal_year: 'FY24', gross_amount: '$75,000.00', fund_name: 'Network Unrestricted', project: 'Network', grant_status: 'Funded' }),
  row({ contact_id: 'D-197', donor_name: 'William Penn Foundation', gift_id: 'G-0332', date: 'Aug 2023', fiscal_year: 'FY24', gross_amount: '$425,000.00', fund_name: 'William Penn', project: 'Launchpad', grant_status: 'Funded' }),
  row({ contact_id: 'D-197', donor_name: 'William Penn Foundation', gift_id: 'G-0430', date: 'Aug 2024', fiscal_year: 'FY25', gross_amount: '$75,000.00', fund_name: 'Network Unrestricted', project: 'Network', grant_status: 'Funded' }),
  row({ contact_id: 'D-197', donor_name: 'William Penn Foundation', gift_id: 'G-0431', date: 'Aug 2024', fiscal_year: 'FY25', gross_amount: '$425,000.00', fund_name: 'William Penn', project: 'Launchpad', grant_status: 'Funded' }),
  row({ contact_id: 'D-197', donor_name: 'William Penn Foundation', gift_id: 'G-0548', date: 'Aug 2025', fiscal_year: 'FY26', gross_amount: '$75,000.00', fund_name: 'Network Unrestricted', project: 'Network', grant_status: 'Funded' }),
  row({ contact_id: 'D-197', donor_name: 'William Penn Foundation', gift_id: 'G-0549', date: 'Aug 2025', fiscal_year: 'FY26', gross_amount: '$425,000.00', fund_name: 'William Penn', project: 'Launchpad', grant_status: 'Funded' }),
];

describe('parseMoney', () => {
  it('parses the sheet currency formats seen in the dev tabs', () => {
    expect(parseMoney('$1,600,000.00')).toBe(1600000);
    expect(parseMoney('$20,087')).toBe(20087);
    expect(parseMoney('20000')).toBe(20000);
    expect(parseMoney('$0.00')).toBe(0);
    expect(parseMoney('$102.56')).toBe(102.56);
  });

  it('reads an accounting negative', () => {
    expect(parseMoney('($500.00)')).toBe(-500);
  });

  // The load-bearing case. These values get summed; a blank returning 0 would make a partial sum
  // indistinguishable from a complete one, which is the whole class of bug #306 is about.
  it('returns null, never 0, for anything unparseable', () => {
    for (const input of ['', '   ', 'n/a', '[VP]', 'NOT YET MARKED', 'TBD', 'pending', '-', undefined, null]) {
      expect(parseMoney(input as string | null | undefined)).toBeNull();
    }
  });

  it('distinguishes a real zero from an absent value', () => {
    expect(parseMoney('$0.00')).toBe(0);
    expect(parseMoney('')).toBeNull();
  });
});

describe('cell', () => {
  it('returns null for the grants tracker withholding markers rather than the literal string', () => {
    const tracker = row({ owner: '[VP]', deadline: '[VP]', gh_grant_agree: 'NOT YET MARKED', funder: 'American Bank' });
    expect(cell(tracker, 'owner')).toBeNull();
    expect(cell(tracker, 'deadline')).toBeNull();
    expect(cell(tracker, 'gh_grant_agree')).toBeNull();
    expect(cell(tracker, 'funder')).toBe('American Bank');
  });

  it('returns null for a missing key', () => {
    expect(cell(WPF_CONTACT, 'no_such_column')).toBeNull();
  });
});

describe('sumMoney', () => {
  it('reports how many rows it could not parse instead of silently dropping them', () => {
    const rows = [row({ amt: '$100.00' }), row({ amt: '' }), row({ amt: '$50.00' }), row({ amt: '[VP]' })];
    expect(sumMoney(rows, 'amt')).toEqual({ total: 150, counted: 2, unparseable: 2 });
  });
});

describe('nameMatches', () => {
  it('matches on the donor name column', () => {
    expect(nameMatches(WPF_CONTACT, 'William Penn')).toBe(true);
    expect(nameMatches(WPF_CONTACT, 'william penn foundation')).toBe(true);
  });

  it('matches the grants tracker `funder` column, which is the name column on that tab', () => {
    expect(nameMatches(row({ funder: 'William Penn Foundation' }), 'William Penn')).toBe(true);
  });

  it('matches a person by either name part', () => {
    expect(nameMatches(WPF_CONTACT, 'Waller')).toBe(true);
    expect(nameMatches(WPF_CONTACT, 'Stephanie')).toBe(true);
  });

  // The regression this function exists for. `query_finances {contains:"William Penn"}` matches the
  // serialized rowData and so returns Project Based Learning, Inc. — whose primary_fund is
  // "William Penn". Reporting that org's giving under a William Penn lookup would be worse than
  // returning nothing.
  it('does NOT match a fund name that happens to carry the searched funder’s name', () => {
    expect(nameMatches(PBL_CONTACT, 'William Penn')).toBe(false);
    expect(nameMatches(PBL_CONTACT, 'Project Based Learning')).toBe(true);
  });

  it('never matches on an empty needle', () => {
    expect(nameMatches(WPF_CONTACT, '')).toBe(false);
    expect(nameMatches(WPF_CONTACT, '   ')).toBe(false);
  });
});

describe('donorNameOf', () => {
  it('prefers donor_name, falls back to funder, then to the split person columns', () => {
    expect(donorNameOf(WPF_CONTACT)).toBe('William Penn Foundation');
    expect(donorNameOf(row({ funder: 'American Bank' }))).toBe('American Bank');
    expect(donorNameOf(row({ primary_first_name: 'Ali', primary_last_name: 'Behbahani' }))).toBe('Ali Behbahani');
    expect(donorNameOf(row({ zip: '19104' }))).toBeNull();
  });
});

describe('isLaunchpad', () => {
  it('reads the differently-named project column on each tab', () => {
    expect(isLaunchpad(row({ projects: 'Launchpad, Network' }), DEV_TABS.contacts)).toBe(true);
    expect(isLaunchpad(row({ project: 'Launchpad' }), DEV_TABS.givingHistory)).toBe(true);
    expect(isLaunchpad(row({ project_s: 'Launchpad, Network' }), DEV_TABS.grantsTracker)).toBe(true);
  });

  it('excludes a row scoped to another project', () => {
    expect(isLaunchpad(row({ projects: 'Philly' }), DEV_TABS.contacts)).toBe(false);
    expect(isLaunchpad(row({ project: 'Network' }), DEV_TABS.givingHistory)).toBe(false);
    expect(isLaunchpad(row({ project: '' }), DEV_TABS.givingHistory)).toBe(false);
  });

  // A wrong column name here would silently disable launchpad_only rather than erroring, so the
  // per-tab mapping is asserted rather than assumed: contacts uses `projects`, the gift and pipeline
  // tabs use `project`, the tracker uses `project_s`.
  it('does not read the contacts column name on a gift row', () => {
    expect(isLaunchpad(row({ projects: 'Launchpad' }), DEV_TABS.givingHistory)).toBe(false);
  });

  it('treats every launchpad pipeline row as in scope — that tab has no project column', () => {
    expect(isLaunchpad(row({ donor_name: 'Patricia Kind Foundation' }), DEV_TABS.launchpadPipeline)).toBe(true);
  });
});

describe('indexByContactId / rowsForDonor', () => {
  it('groups by the CRM contact key', () => {
    const index = indexByContactId(WPF_GIFTS);
    expect(index.get('D-197')).toHaveLength(7);
  });

  it('skips rows with no contact_id rather than bucketing them under an empty key', () => {
    expect(indexByContactId([row({ donor_name: 'Eagles Social Justic Fund' })]).size).toBe(0);
  });

  it('joins by contact_id when the row has one', () => {
    expect(rowsForDonor(WPF_GIFTS, 'D-197', 'William Penn Foundation')).toHaveLength(7);
    expect(rowsForDonor(WPF_GIFTS, 'D-999', 'William Penn Foundation')).toHaveLength(0);
  });

  // The `denied` tab leaves contact_id blank on most rows and `launchpad pipeline` has no such
  // column at all, so the name fallback is not a nicety — without it those two tabs never join.
  it('falls back to a name match when the row carries no contact_id', () => {
    const denied = [row({ donor_name: 'William Penn Foundation', grant_status: 'Denied' })];
    expect(rowsForDonor(denied, 'D-197', 'William Penn Foundation')).toHaveLength(1);
  });
});

describe('summariseGiving', () => {
  const all = summariseGiving(WPF_GIFTS);

  it('reproduces the grants tracker lifetime total by summing the gift rows', () => {
    // $1,600,000.00 is what development:grants tracker reports for D-197. Deriving the same number
    // from the individual gifts is what makes it safe to stop reading the broken Contacts column.
    expect(all.total).toBe(1600000);
    expect(all.gift_count).toBe(7);
  });

  it('splits by fiscal year, showing each year as the sum of its two gifts', () => {
    expect(all.by_fiscal_year).toEqual({ FY22: 100000, FY24: 500000, FY25: 500000, FY26: 500000 });
  });

  // The finding that changes a funder-facing figure: $500,000/yr is the Building 21 total, of which
  // Launchpad's share is $425,000. A draft quoting $500,000 as Launchpad's grant overstates it.
  it('splits by project, separating Launchpad’s share from Network’s', () => {
    expect(all.by_project).toEqual({ Launchpad: 1375000, Network: 225000 });
  });

  it('scopes to Launchpad when the caller asked for it', () => {
    const launchpadOnly = summariseGiving(
      WPF_GIFTS.filter((g) => isLaunchpad(g, DEV_TABS.givingHistory)),
    );
    expect(launchpadOnly.total).toBe(1375000);
    expect(launchpadOnly.by_fiscal_year).toEqual({ FY22: 100000, FY24: 425000, FY25: 425000, FY26: 425000 });
  });

  it('counts unparseable amounts separately rather than folding them in as zero', () => {
    const withGap = summariseGiving([...WPF_GIFTS, row({ fiscal_year: 'FY27', gross_amount: 'pending', project: 'Launchpad' })]);
    expect(withGap.total).toBe(1600000);
    expect(withGap.amounts_unparseable).toBe(1);
    expect(withGap.by_fiscal_year['FY27']).toBeUndefined();
  });

  it('reports an empty history without throwing', () => {
    const none = summariseGiving([]);
    expect(none.total).toBe(0);
    expect(none.gift_count).toBe(0);
    expect(none.first_gift).toBeNull();
  });
});

describe('the Contacts tab giving columns are not a source', () => {
  // Recorded as a test so a future change cannot quietly start reading them again. William Penn's
  // row says $0.00 lifetime against a real $1,600,000.00 — and cy2025_giving on the same row carries
  // $500,000.00, so the tab is inconsistent rather than uniformly empty. That inconsistency is why
  // it is unusable: a caller cannot tell a true zero from a broken one.
  it('would report $0 lifetime for a funder that has given $1.6M', () => {
    expect(parseMoney(WPF_CONTACT.data['lifetime_giving'])).toBe(0);
    expect(parseMoney(WPF_CONTACT.data['cy2025_giving'])).toBe(500000);
    expect(summariseGiving(WPF_GIFTS).total).toBe(1600000);
  });
});
