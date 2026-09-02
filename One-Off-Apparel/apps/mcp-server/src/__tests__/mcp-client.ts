import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, '..', '..', 'dist', 'index.js');

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = '';
  private pending = new Map<number, (r: JsonRpcResponse) => void>();
  private readonly ready: Promise<void>;

  constructor(env: NodeJS.ProcessEnv = {}) {
    this.proc = spawn('node', [serverEntry], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onChunk(chunk));

    this.ready = this.initialize();
  }

  private onChunk(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (typeof msg.id === 'number') {
          const cb = this.pending.get(msg.id);
          if (cb) {
            this.pending.delete(msg.id);
            cb(msg);
          }
        }
      } catch {
        // ignore non-JSON output (server logs etc.)
      }
    }
  }

  private async initialize(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'integration-test', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
  }

  private rpc(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise<JsonRpcResponse>((resolveResp, rejectResp) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResp(new Error(`RPC ${method} timed out`));
      }, 10000);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolveResp(r);
      });
      this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    const msg = { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    const response = await this.rpc('tools/call', { name, arguments: args });
    if (response.error) {
      throw new Error(`MCP error: ${response.error.message}`);
    }
    const result = response.result as {
      content?: Array<{ type: string; text: string }>;
    };
    const text = result.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error('Tool response missing text content');
    }
    return JSON.parse(text);
  }

  async listTools(): Promise<Array<{ name: string; description: string }>> {
    await this.ready;
    const response = await this.rpc('tools/list', {});
    const result = response.result as {
      tools: Array<{ name: string; description: string }>;
    };
    return result.tools;
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}
