import { google } from 'googleapis';

function requireJson(): string {
  const v = process.env['GOOGLE_SERVICE_ACCOUNT_JSON'];
  if (!v) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  return v;
}

function getAuth(): InstanceType<typeof google.auth.GoogleAuth> {
  const keyJson = Buffer.from(requireJson(), 'base64').toString('utf-8');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(keyJson) as object,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheets() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.sheets({ version: 'v4', auth: getAuth() as any });
}

export async function getSheetRows(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const res = await getSheets().spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values ?? []) as string[][];
}

export async function listSheetTitles(spreadsheetId: string): Promise<string[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  return (res.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);
}

export async function getSheetGridDimensions(
  spreadsheetId: string,
): Promise<Map<string, { rowCount: number; columnCount: number }>> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title,gridProperties(rowCount,columnCount))',
  });
  const map = new Map<string, { rowCount: number; columnCount: number }>();
  for (const s of res.data.sheets ?? []) {
    const title = s.properties?.title;
    if (!title) continue;
    map.set(title, {
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      columnCount: s.properties?.gridProperties?.columnCount ?? 26,
    });
  }
  return map;
}

export async function getAllSheetRows(
  spreadsheetId: string,
  targetTabs?: string[],
): Promise<Map<string, string[][]>> {
  const sheets = getSheets();

  if (targetTabs) {
    const result = new Map<string, string[][]>();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    type SheetInfo = { sheetId: number; rowCount: number; columnCount: number; actualTitle: string };
    const sheetMap = new Map<string, SheetInfo>();
    for (const s of meta.data.sheets ?? []) {
      const title = s.properties?.title;
      const sheetId = s.properties?.sheetId;
      const rowCount = s.properties?.gridProperties?.rowCount;
      const columnCount = s.properties?.gridProperties?.columnCount;
      if (title && sheetId != null && rowCount && columnCount) {
        sheetMap.set(title.toLowerCase(), { sheetId, rowCount, columnCount, actualTitle: title });
      }
    }

    for (const tab of targetTabs) {
      const info = sheetMap.get(tab.toLowerCase());
      if (!info) {
        const available = [...sheetMap.values()].map((v) => v.actualTitle).join(', ');
        console.warn(`    tab "${tab}" not found in spreadsheet (available: ${available})`);
        result.set(tab, []);
        continue;
      }

      const res = await sheets.spreadsheets.getByDataFilter({
        spreadsheetId,
        requestBody: {
          dataFilters: [{
            gridRange: {
              sheetId: info.sheetId,
              startRowIndex: 0,
              endRowIndex: info.rowCount,
              startColumnIndex: 0,
              endColumnIndex: info.columnCount,
            },
          }],
          includeGridData: true,
        },
      });

      const sheet = res.data.sheets?.[0];
      const rowData = sheet?.data?.[0]?.rowData ?? [];
      const rows = rowData.map((row) =>
        (row.values ?? []).map((cell) => cell.formattedValue ?? ''),
      );
      result.set(tab, rows);
    }

    return result;
  }

  const res = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: true });
  const result = new Map<string, string[][]>();
  for (const sheet of res.data.sheets ?? []) {
    const title = sheet.properties?.title;
    if (!title) continue;
    const rows = (sheet.data?.[0]?.rowData ?? []).map((row) =>
      (row.values ?? []).map((cell) => cell.formattedValue ?? ''),
    );
    result.set(title, rows);
  }
  return result;
}
