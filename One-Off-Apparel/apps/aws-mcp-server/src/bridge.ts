import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { execSync } from 'node:child_process';

async function main() {
  const remoteUrl = process.env['AWS_MCP_URL'] ?? 'http://localhost:8081/mcp';
  const remoteToken = process.env['AWS_MCP_TOKEN'] ?? 'default-secret-token';

  // Get developer email automatically from git config to pass down for session tagging and audit logs
  let developerEmail = '';
  try {
    developerEmail = execSync('git config user.email').toString().trim();
  } catch {
    developerEmail = 'unknown-agent-user@example.com';
  }

  // 1. Initialize remote HTTP client
  const transport = new StreamableHTTPClientTransport(new URL(remoteUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${remoteToken}`,
      },
    },
  });

  const client = new Client(
    { name: 'aws-mcp-bridge-client', version: '1.0.0' }
  );

  await client.connect(transport as unknown as Transport);

  // 2. Query remote server tools
  const { tools } = await client.listTools();

  // 3. Create local Stdio Server
  const server = new McpServer({
    name: 'lp-aws-mcp-bridge',
    version: '1.0.0',
  });

  // 4. Mirror remote tools to local stdio interface
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description ?? 'AWS Resource Tool',
        inputSchema: (tool.inputSchema as any) ?? {},
      },
      async (args: any) => {
        // Auto-inject developer email if invoking plan tool and it was omitted
        const finalArgs = { ...args };
        if (tool.name === 'aws_plan_resource_change' && !finalArgs['developerEmail']) {
          finalArgs['developerEmail'] = developerEmail;
        }

        try {
          const response = await client.callTool({
            name: tool.name,
            arguments: finalArgs,
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
