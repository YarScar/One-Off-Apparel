import { loadEnv } from '@lp-ai/lib-config';

const BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionFetchOpts {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
}

/** Thin authenticated wrapper over the Notion REST API, keyed on NOTION_API_KEY. */
export async function notionFetch<T>(path: string, opts: NotionFetchOpts = {}): Promise<T> {
  const env = await loadEnv();
  const apiKey = env.NOTION_API_KEY;
  if (!apiKey) throw new Error('NOTION_API_KEY not set');

  const method = opts.method ?? 'GET';
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion ${method} ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface NotionParent {
  type: string;
  database_id?: string;
  data_source_id?: string;
  page_id?: string;
}

export interface NotionPage {
  id: string;
  created_time: string;
  created_by: { id: string };
  parent: NotionParent;
  properties: Record<string, unknown>;
}

export async function getPage(pageId: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${pageId}`);
}

/** Resolve a Notion user id → their email (workspace members expose person.email). */
export async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const user = await notionFetch<{ type?: string; person?: { email?: string } }>(`/users/${userId}`);
    return user.person?.email ?? null;
  } catch {
    return null;
  }
}

/** Find People & Entities page ids whose Email property equals the given address. */
export async function findPeopleByEmail(peopleDbId: string, email: string): Promise<string[]> {
  const res = await notionFetch<{ results: Array<{ id: string }> }>(
    `/databases/${peopleDbId}/query`,
    {
      method: 'POST',
      body: { filter: { property: 'Email', email: { equals: email } }, page_size: 5 },
    },
  );
  return res.results.map((r) => r.id);
}

/** Patch arbitrary page properties (Notion property-value shapes). */
export async function updatePageProperties(
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await notionFetch(`/pages/${pageId}`, { method: 'PATCH', body: { properties } });
}

/** Create a new People & Entities row. Returns the new page id. */
export async function createPerson(
  peopleDbId: string,
  opts: { name: string; email: string; type: string; organization?: string },
): Promise<string> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: opts.name } }] },
    Email: { email: opts.email },
    Type: { multi_select: [{ name: opts.type }] },
    Status: { select: { name: 'Active' } },
  };
  if (opts.organization) {
    properties['Organization'] = { rich_text: [{ text: { content: opts.organization } }] };
  }
  const res = await notionFetch<{ id: string }>(
    `/pages`,
    { method: 'POST', body: { parent: { database_id: peopleDbId }, properties } },
  );
  return res.id;
}
