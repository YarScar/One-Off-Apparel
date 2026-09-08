const BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const USER_AGENT = 'LaunchpadInternalAI/1.0';
const REQUEST_DELAY_MS = 350;

let lastRequestAt = 0;

async function rateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

interface NotionFetchOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
}

export async function notionFetch<T>(path: string, opts: NotionFetchOpts = {}): Promise<T> {
  const apiKey = process.env['NOTION_API_KEY'];
  if (!apiKey) throw new Error('NOTION_API_KEY not set');

  await rateLimit();
  const method = opts.method ?? 'GET';
  const init: RequestInit = {
    method,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Notion-Version': NOTION_VERSION,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const r = await fetch(BASE_URL + path, init);

  if (r.status === 429) {
    const retryAfter = parseInt(r.headers.get('Retry-After') ?? '5', 10);
    await new Promise((res) => setTimeout(res, retryAfter * 1000));
    return notionFetch<T>(path, opts);
  }

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Notion ${method} ${path} failed: ${r.status} ${r.statusText} — ${text.slice(0, 400)}`);
  }
  return (await r.json()) as T;
}

interface PaginatedResponse<T> {
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export async function* queryDatabase<TPage>(
  databaseId: string,
  filter?: Record<string, unknown>,
): AsyncGenerator<TPage> {
  let startCursor: string | undefined = undefined;
  while (true) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (filter) body['filter'] = filter;
    if (startCursor) body['start_cursor'] = startCursor;

    const resp: PaginatedResponse<TPage> = await notionFetch<PaginatedResponse<TPage>>(
      `/databases/${databaseId}/query`,
      { method: 'POST', body },
    );
    for (const page of resp.results) yield page;
    if (!resp.has_more || !resp.next_cursor) break;
    startCursor = resp.next_cursor;
  }
}

export async function* listBlockChildren<TBlock>(
  blockId: string,
): AsyncGenerator<TBlock> {
  let startCursor: string | undefined = undefined;
  while (true) {
    const qs = new URLSearchParams({ page_size: '100' });
    if (startCursor) qs.set('start_cursor', startCursor);
    const resp: PaginatedResponse<TBlock> = await notionFetch<PaginatedResponse<TBlock>>(
      `/blocks/${blockId}/children?${qs.toString()}`,
    );
    for (const block of resp.results) yield block;
    if (!resp.has_more || !resp.next_cursor) break;
    startCursor = resp.next_cursor;
  }
}

export async function getPage<TPage>(pageId: string): Promise<TPage> {
  return notionFetch<TPage>(`/pages/${pageId}`);
}
