import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function makeServer(): McpServer {
  const server = new McpServer({
    name: 'lp-internal-ai',
    version: '1.0.0',
  });

  return server;
}
