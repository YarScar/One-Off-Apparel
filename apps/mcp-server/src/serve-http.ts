import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { loadEnv } from '@lp-ai/lib-config';
import { prisma } from '@lp-ai/lib-db';

import { makeServer } from './make-server.js';

const env = await loadEnv();
const PORT = Number(process.env['PORT'] ?? '8080');
const SYNC_SECRET = env.SYNC_SECRET;

const mcpServer = makeServer();
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

await mcpServer.connect(transport as unknown as Transport);

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return undefined;
  return JSON.parse(text);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage): boolean {
  if (!SYNC_SECRET) return true;
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return false;
  if (!header.startsWith('Bearer ')) return false;
  return header.slice('Bearer '.length) === SYNC_SECRET;
}

const httpServer = createServer((req, res) => {
  void (async () => {
    try {
      const url = req.url ?? '/';

      if (url === '/health' || url === '/') {
        try {
          await prisma.$queryRaw`SELECT 1`;
          send(res, 200, { status: 'ok', ts: new Date().toISOString() });
        } catch (err) {
          send(res, 503, {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (url.startsWith('/mcp')) {
        if (!authorized(req)) {
          send(res, 401, { error: 'unauthorized' });
          return;
        }
        const body = await readBody(req);
        await transport.handleRequest(req, res, body);
        return;
      }

      send(res, 404, { error: 'not_found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`http error: ${message}\n`);
      try {
        send(res, 500, { error: 'internal_error', message });
      } catch {
        // headers already sent
      }
    }
  })();
});

httpServer.listen(PORT, () => {
  process.stdout.write(
    `MCP server listening on http://0.0.0.0:${PORT.toString()} (mcp at /mcp, health at /health)\n`,
  );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    process.stdout.write(`\nReceived ${signal}, shutting down...\n`);
    httpServer.close(() => {
      void mcpServer.close().then(() => process.exit(0));
    });
  });
}
