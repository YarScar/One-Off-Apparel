import * as Sentry from '@sentry/node';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { loadEnv } from '@lp-ai/lib-config';
import { prisma } from '@lp-ai/lib-db';

import { makeServer } from './make-server.js';
import { authenticateBearer } from './auth.js';

const env = await loadEnv();
if (env.SENTRY_DSN_MCP) {
  Sentry.init({ dsn: env.SENTRY_DSN_MCP, environment: process.env['NODE_ENV'], tracesSampleRate: 0.1 });
}
const PORT = Number(process.env['AWS_MCP_PORT'] ?? process.env['PORT'] ?? '8081');

// One transport per client session — see the equivalent note in
// apps/mcp-server/src/serve-http.ts. A shared transport trips the
// MCP SDK's "Server already initialized" guard on the second client.
const sessions = new Map<string, StreamableHTTPServerTransport>();

function createTransport(): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      sessions.set(sessionId, transport);
    },
    onsessionclosed: (sessionId: string) => {
      sessions.delete(sessionId);
    },
  });
  const server = makeServer();
  void server.connect(transport as unknown as Transport);
  return transport;
}

type TransportLookup =
  | { kind: 'found'; transport: StreamableHTTPServerTransport }
  | { kind: 'new'; transport: StreamableHTTPServerTransport }
  | { kind: 'session_gone' };

function transportForRequest(req: IncomingMessage): TransportLookup {
  const sid = req.headers['mcp-session-id'];
  if (typeof sid === 'string' && sid.length > 0) {
    const existing = sessions.get(sid);
    if (existing) return { kind: 'found', transport: existing };
    // Unknown session — return 404 so the client knows to reinitialize.
    return { kind: 'session_gone' };
  }
  return { kind: 'new', transport: createTransport() };
}

async function protectedResourceMetadata(): Promise<object> {
  const e = await loadEnv();
  const issuer = e.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  const resource = e.AWS_MCP_PUBLIC_URL ?? 'https://aws-mcp.launchpadinc.org';
  return {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
  };
}

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

const httpServer = createServer((req, res) => {
  void (async () => {
    try {
      const rawUrl = req.url ?? '/';
      const url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`);
      const path = url.pathname;

      if (path === '/health' || path === '/') {
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

      if (path === '/.well-known/oauth-protected-resource') {
        send(res, 200, await protectedResourceMetadata());
        return;
      }

      if (path === '/mcp') {
        const identity = await authenticateBearer(req.headers['authorization'] as string | undefined);
        if (!identity) {
          send(res, 401, { error: 'unauthorized' });
          return;
        }
        const lookup = transportForRequest(req);
        if (lookup.kind === 'session_gone') {
          process.stdout.write(
            JSON.stringify({
              lvl: 'info',
              kind: 'session_gone',
              sid: req.headers['mcp-session-id'],
            }) + '\n',
          );
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found — reinitialize' },
              id: null,
            }),
          );
          return;
        }
        const body = await readBody(req);
        await lookup.transport.handleRequest(req, res, body);
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
    `AWS MCP server listening on http://0.0.0.0:${PORT.toString()} (mcp at /mcp, health at /health)\n`,
  );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    process.stdout.write(`\nReceived ${signal}, shutting down...\n`);
    httpServer.close(() => {
      Promise.all(Array.from(sessions.values()).map((t) => t.close().catch(() => undefined)))
        .then(() => process.exit(0))
        .catch(() => process.exit(0));
    });
  });
}
