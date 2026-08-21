/**
 * Google Docs API v1 client for multi-tab document extraction.
 *
 * The public `files.export?mimeType=text/plain` path only reliably returns the
 * first tab of a tabbed doc; anything past the first tab is silently missing.
 * This module uses `documents.get?includeTabsContent=true` and walks the returned
 * tab tree so every tab's body ends up in the extracted text.
 *
 * Auth uses the same GOOGLE_SERVICE_ACCOUNT_JSON as the Drive client, plus the
 * OAuth-user fallback for local dev. Scope must include `documents.readonly`;
 * `drive.readonly` alone is not sufficient for the Docs API.
 */
import { google, type docs_v1 } from 'googleapis';

/**
 * Tab types not yet present in googleapis@140 typings. The Docs API returns
 * these at runtime when `includeTabsContent=true`; we model just the shape we
 * consume and cast the response through.
 */
interface DocumentTab {
  tabProperties?: { title?: string | null } | null;
  documentTab?: { body?: { content?: docs_v1.Schema$StructuralElement[] } | null } | null;
  childTabs?: DocumentTab[] | null;
}
interface DocumentWithTabs extends docs_v1.Schema$Document {
  tabs?: DocumentTab[] | null;
}

const SCOPES = [
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

const REQUEST_TIMEOUT_MS = 30_000;

export interface OAuthUserCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function serviceAccountDocs(serviceAccountJsonBase64: string): docs_v1.Docs {
  const credentials = JSON.parse(
    Buffer.from(serviceAccountJsonBase64, 'base64').toString('utf-8'),
  ) as object;
  return google.docs({
    version: 'v1',
    auth: new google.auth.GoogleAuth({ credentials, scopes: [...SCOPES] }),
  });
}

function oauthUserDocs(creds: OAuthUserCredentials): docs_v1.Docs {
  const auth = new google.auth.OAuth2({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return google.docs({ version: 'v1', auth });
}

export type DocsClient = docs_v1.Docs;

export function makeDocsClient(serviceAccountJsonBase64: string): DocsClient {
  return serviceAccountDocs(serviceAccountJsonBase64);
}

export function makeOAuthDocsClient(creds: OAuthUserCredentials): DocsClient {
  return oauthUserDocs(creds);
}

/** Fetch a document with every tab's content included. */
export async function getDocumentAllTabs(
  docs: DocsClient,
  documentId: string,
): Promise<DocumentWithTabs> {
  const res = await docs.documents.get(
    // includeTabsContent is a valid Docs API v1 param; typings just lag.
    { documentId, includeTabsContent: true } as docs_v1.Params$Resource$Documents$Get & {
      includeTabsContent: boolean;
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );
  return res.data as DocumentWithTabs;
}

export type { DocumentWithTabs, DocumentTab };

// ── Text extraction ────────────────────────────────────────────────────

function textFromParagraph(el: docs_v1.Schema$Paragraph | undefined): string {
  if (!el) return '';
  const runs = el.elements ?? [];
  let out = '';
  for (const r of runs) {
    const txt = r.textRun?.content ?? '';
    out += txt;
  }
  return out;
}

function textFromTable(el: docs_v1.Schema$Table | undefined): string {
  if (!el) return '';
  const lines: string[] = [];
  for (const row of el.tableRows ?? []) {
    const cells: string[] = [];
    for (const cell of row.tableCells ?? []) {
      cells.push(textFromStructuralElements(cell.content ?? []).trim().replace(/\s+/g, ' '));
    }
    lines.push(cells.join(' | '));
  }
  return lines.join('\n');
}

function textFromStructuralElements(elements: docs_v1.Schema$StructuralElement[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    if (el.paragraph) {
      const style = el.paragraph.paragraphStyle?.namedStyleType;
      const raw = textFromParagraph(el.paragraph).replace(/\n$/, '');
      if (!raw.trim()) continue;
      if (style === 'HEADING_1') parts.push(`# ${raw}`);
      else if (style === 'HEADING_2') parts.push(`## ${raw}`);
      else if (style === 'HEADING_3') parts.push(`### ${raw}`);
      else if (style === 'HEADING_4' || style === 'HEADING_5' || style === 'HEADING_6') {
        parts.push(`#### ${raw}`);
      } else if (el.paragraph.bullet) {
        parts.push(`- ${raw}`);
      } else {
        parts.push(raw);
      }
    } else if (el.table) {
      parts.push(textFromTable(el.table));
    } else if (el.tableOfContents?.content) {
      parts.push(textFromStructuralElements(el.tableOfContents.content));
    }
    // sectionBreak, horizontalRule, and other elements have no text worth keeping
  }
  return parts.join('\n');
}

function textFromTab(tab: DocumentTab, depth: number): string {
  const parts: string[] = [];
  const title = tab.tabProperties?.title?.trim();
  if (title) {
    const prefix = depth === 0 ? '## ' : `${'#'.repeat(Math.min(2 + depth, 6))} `;
    parts.push(`${prefix}${title}`);
  }
  const body = tab.documentTab?.body?.content ?? [];
  const bodyText = textFromStructuralElements(body);
  if (bodyText.trim()) parts.push(bodyText);
  for (const child of tab.childTabs ?? []) {
    parts.push(textFromTab(child, depth + 1));
  }
  return parts.join('\n\n');
}

/**
 * Flatten a tabbed document into plain markdown-ish text. Tab titles become
 * headings so retrieval keeps the tab context visible in the chunk content.
 */
export function extractTextFromTabs(doc: DocumentWithTabs): string {
  const parts: string[] = [];
  const docTitle = doc.title?.trim();
  if (docTitle) parts.push(`# ${docTitle}`);
  const tabs = doc.tabs;
  if (tabs && tabs.length > 0) {
    for (const tab of tabs) parts.push(textFromTab(tab, 0));
  } else if (doc.body?.content) {
    parts.push(textFromStructuralElements(doc.body.content));
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
