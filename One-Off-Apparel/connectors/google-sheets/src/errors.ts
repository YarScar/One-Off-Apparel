export type SheetSettingsMismatch = {
  spreadsheetId: string;
  tabName: string;
  cell: string;
  label: string;
  expected: string;
  actual: string;
};

export class SheetSettingsMismatchError extends Error {
  public readonly mismatches: SheetSettingsMismatch[];

  constructor(mismatches: SheetSettingsMismatch[]) {
    const summary = mismatches
      .map((m) => `'${m.tabName}'!${m.cell} (${m.label}): expected "${m.expected}", got "${m.actual || '(blank)'}"`)
      .join('; ');
    super(
      `Sheet settings mismatch — sync skipped (this connector is read-only). ` +
      `Fix manually in the source sheet: ${summary}`,
    );
    this.name = 'SheetSettingsMismatchError';
    this.mismatches = mismatches;
  }
}

export function logSheetSettingsMismatch(err: SheetSettingsMismatchError): void {
  console.error('\nSHEET SETTINGS MISMATCH — manual fix required (connector is read-only)');
  for (const m of err.mismatches) {
    console.error(`    - '${m.tabName}'!${m.cell} (${m.label}): expected "${m.expected}", got "${m.actual || '(blank)'}"`);
  }
  console.error('');
}

export class HeaderMismatchError extends Error {
  constructor(public detail: string) {
    super(`students_header_mismatch: ${detail}`);
    this.name = 'HeaderMismatchError';
  }
}
