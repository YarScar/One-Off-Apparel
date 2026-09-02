import * as Sentry from '@sentry/node';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { loadEnv } from '@lp-ai/lib-config';
import { prisma } from '@lp-ai/lib-db';

import { makeServer } from './make-server.js';
import { authenticateBearer, type CallerIdentity } from './auth.js';
import { jwks } from './oauth/jwks.js';
import { authorizationServerMetadata, protectedResourceMetadata } from './oauth/metadata.js';
import { registerClient } from './oauth/dcr.js';
import { handleAuthorize, handleGoogleCallback, handleToken } from './oauth/flow.js';
import { setCurrentCaller } from './tool-helpers.js';
import { oauthRegisterLimiter, oauthFlowLimiter, mcpLimiter, getClientIp } from './rate-limit.js';

const env = await loadEnv();
if (env.SENTRY_DSN_MCP) {
  Sentry.init({ dsn: env.SENTRY_DSN_MCP, environment: process.env['NODE_ENV'], tracesSampleRate: 0.1 });
}
const PORT = Number(process.env['PORT'] ?? '8080');

// One McpServer + StreamableHTTPServerTransport per *client session* — sharing
// a single transport across clients trips the "Server already initialized"
// guard the moment the second client tries to handshake. Sessions are keyed
// by the Mcp-Session-Id header the SDK negotiates during initialize.
//
// We also keep an "uninitialized" transport on standby so we can hand it to
// the first request from a client that hasn't picked up a session ID yet.
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
    // Client sent a session ID we don't know about — probably from a task
    // that was replaced during a deploy. Per MCP Streamable HTTP spec, we
    // return HTTP 404 so the client knows to send a fresh InitializeRequest
    // (without a session ID) instead of treating this as a fatal disconnect.
    return { kind: 'session_gone' };
  }
  // No session ID — initialize or stateless request. Mint a new transport.
  return { kind: 'new', transport: createTransport() };
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

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function sendRedirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function logOauth(req: IncomingMessage, status: number, extra: Record<string, unknown> = {}): void {
  const url = req.url ?? '';
  if (!url.startsWith('/oauth/') && !url.startsWith('/.well-known/')) return;
  process.stdout.write(
    JSON.stringify({
      lvl: 'info',
      kind: 'oauth',
      method: req.method,
      url,
      status,
      ua: req.headers['user-agent'],
      ...extra,
    }) + '\n',
  );
}

const httpServer = createServer((req, res) => {
  void (async () => {
    try {
      const rawUrl = req.url ?? '/';
      const url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`);
      const path = url.pathname;
      // Capture the response status so we can log it after the handler runs.
      const origWriteHead = res.writeHead.bind(res);
      let responseStatus = 0;
      res.writeHead = ((status: number, ...rest: unknown[]) => {
        responseStatus = status;
        return (origWriteHead as unknown as (...args: unknown[]) => unknown)(status, ...rest);
      }) as typeof res.writeHead;
      res.on('finish', () => logOauth(req, responseStatus));

      // ----- health -----
      if (path === '/health' || path === '/') {
        try {
          await prisma.$queryRaw`SELECT 1`;
          sendJson(res, 200, { status: 'ok', ts: new Date().toISOString() });
        } catch (err) {
          process.stderr.write(`health check failed: ${err instanceof Error ? err.message : String(err)}\n`);
          sendJson(res, 503, { status: 'error', error: 'database unavailable' });
        }
        return;
      }

      // ----- OAuth discovery metadata -----
      if (path === '/.well-known/oauth-protected-resource') {
        sendJson(res, 200, await protectedResourceMetadata());
        return;
      }
      if (path === '/.well-known/oauth-authorization-server') {
        sendJson(res, 200, await authorizationServerMetadata());
        return;
      }
      if (path === '/.well-known/jwks.json') {
        sendJson(res, 200, await jwks());
        return;
      }

      // ----- Dynamic Client Registration -----
      if (path === '/oauth/register' && req.method === 'POST') {
        const ip = getClientIp(req);
        if (!oauthRegisterLimiter.check(ip)) {
          sendJson(res, 429, { error: 'rate_limit_exceeded', error_description: 'Too many registration requests' });
          return;
        }
        try {
          const body = (await readBody(req)) as Record<string, unknown>;
          const out = await registerClient({
            client_name: body['client_name'] as string | undefined,
            redirect_uris: body['redirect_uris'] as string[],
          });
          sendJson(res, 201, out);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'bad registration';
          process.stderr.write(`DCR error: ${msg}\n`);
          sendJson(res, 400, {
            error: 'invalid_client_metadata',
            error_description: msg.startsWith('invalid_redirect_uri') ? msg : 'registration failed',
          });
        }
        return;
      }

      // ----- Authorize (browser arrives here) -----
      if (path === '/oauth/authorize' && req.method === 'GET') {
        const ip = getClientIp(req);
        if (!oauthFlowLimiter.check(ip)) {
          sendJson(res, 429, { error: 'rate_limit_exceeded' });
          return;
        }
        const result = await handleAuthorize(url.searchParams);
        if (result.status === 302) {
          sendRedirect(res, result.redirect);
        } else {
          sendJson(res, result.status, { error: 'invalid_request' });
        }
        return;
      }

      // ----- Google callback -----
      if (path === '/oauth/google-callback' && req.method === 'GET') {
        const result = await handleGoogleCallback(url.searchParams);
        if (result.status === 302) {
          sendRedirect(res, result.redirect);
        } else if (result.body && result.body.startsWith('<!doctype')) {
          sendHtml(res, result.status, result.body);
        } else {
          sendJson(res, result.status, { error: result.body ?? 'callback_failed' });
        }
        return;
      }

      // ----- Token exchange -----
      if (path === '/oauth/token' && req.method === 'POST') {
        const ip = getClientIp(req);
        if (!oauthFlowLimiter.check(ip)) {
          sendJson(res, 429, { error: 'rate_limit_exceeded' });
          return;
        }
        const body = await readFormBody(req);
        const result = await handleToken(body);
        sendJson(res, result.status, result.json);
        return;
      }

      // ----- MCP protocol -----
      if (path === '/mcp') {
        const identity = await authenticateBearer(req.headers['authorization'] as string | undefined);
        if (!identity) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        const rateLimitKey = identity.kind === 'user' ? identity.email : `_service:${getClientIp(req)}`;
        if (!mcpLimiter.check(rateLimitKey)) {
          sendJson(res, 429, { error: 'rate_limit_exceeded', error_description: 'Too many tool calls' });
          return;
        }
        const lookup = transportForRequest(req);
        if (lookup.kind === 'session_gone') {
          // Tell the client the session is gone — per MCP Streamable HTTP
          // spec the client must then send a fresh InitializeRequest
          // (without a session ID) to re-establish.
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
        setCurrentCaller(identity);
        try {
          const body = await readBody(req);
          await lookup.transport.handleRequest(req, res, body);
        } finally {
          setCurrentCaller(null);
        }
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      process.stderr.write(`http error: ${err instanceof Error ? err.message : String(err)}\n`);
      try {
        sendJson(res, 500, { error: 'internal_error' });
      } catch {
        // headers already sent
      }
    }
  })();
});

httpServer.listen(PORT, () => {
  process.stdout.write(
    `MCP server listening on http://0.0.0.0:${PORT.toString()} (mcp at /mcp, oauth at /oauth/*, health at /health)\n`,
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

// Re-export for typing; CallerIdentity is consumed by tool-helpers
export type { CallerIdentity };
