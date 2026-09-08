import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function makeServer(): McpServer {
  const server = new McpServer({
    name: 'lp-aws-mcp',
    version: '1.0.0',
  });

  return server;
}
