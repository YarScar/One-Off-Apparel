import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

async function main() {
  const remoteUrl = process.env['MCP_URL'] ?? 'http://localhost:8080/mcp';
  const remoteToken = process.env['SYNC_SECRET'] ?? 'default-secret-token';

  // 1. Initialize remote HTTP client
  const transport = new StreamableHTTPClientTransport(new URL(remoteUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${remoteToken}`,
      },
    },
  });

  const client = new Client(
    { name: 'mcp-bridge-client', version: '1.0.0' }
  );

  await client.connect(transport as unknown as Transport);

  // 2. Query remote server tools
  const { tools } = await client.listTools();

  // 3. Create local Stdio Server
  const server = new McpServer({
    name: 'lp-mcp-bridge',
    version: '1.0.0',
  });

  // 4. Mirror remote tools to local stdio interface
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description ?? 'LP Internal Tool',
        inputSchema: (tool.inputSchema as any) ?? {},
      },
      async (args: any) => {
        try {
          const response = await client.callTool({
            name: tool.name,
            arguments: args,
          });
          return response as any;
        } catch (err: any) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: {
                    code: 'execution_failed',
                    message: `Bridge failed to call remote tool: ${err.message}`,
                  },
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  // 5. Connect local stdio interface
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
}

main().catch((err) => {
  process.stderr.write(`Bridge initialization fatal error: ${String(err)}\n`);
  process.exit(1);
});
