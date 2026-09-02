import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { prisma } from '@lp-ai/lib-db';
import { makeServer } from './make-server.js';
import { createServer, type IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

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

async function runTest() {
  console.log('🚀 Starting AWS MCP Integration Test...');

  // 1. Start Server
  const mcpServer = makeServer();
  const serverTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(serverTransport as unknown as Transport);

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      if (url.startsWith('/mcp')) {
        const body = await readBody(req);
        await serverTransport.handleRequest(req, res, body);
        return;
      }
      res.writeHead(404);
      res.end();
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  console.log(`✅ Server started on port ${port}`);

  try {
    // 2. Connect Client
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: 'Bearer default-secret-token',
          },
        },
      }
    );
    const client = new Client(
      { name: 'test-client', version: '1.0.0' }
    );
    await client.connect(transport as unknown as Transport);
    console.log('✅ Client connected successfully');

    // 3. Call aws_plan_resource_change
    console.log('👉 Invoking aws_plan_resource_change...');
    const planResult = await client.callTool({
      name: 'aws_plan_resource_change',
      arguments: {
        developerEmail: 'test-developer@launchpadphilly.org',
        terraformCode: `
resource "aws_s3_bucket" "test" {
  bucket = "lp-test-verification-bucket"
}
`,
        resourceType: 'aws_s3_bucket',
        actionType: 'CREATE',
      },
    }) as any;

    const planData = JSON.parse(planResult.content[0].text);
    console.log('📦 Plan Tool Result Data:', planData);

    if (planData.error) {
      throw new Error(`Plan failed: ${planData.error.message}`);
    }

    const { jobId, status } = planData;
    console.log(`✅ Job created with ID: ${jobId}, Status: ${status}`);

    if (status !== 'PENDING_APPROVAL') {
      throw new Error(`Expected status to be PENDING_APPROVAL, got ${status}`);
    }

    // Verify DB entry exists
    const dbJobBefore = await prisma.awsResourceJob.findUnique({
      where: { id: jobId },
    });
    if (!dbJobBefore) {
      throw new Error('Could not find Job in the Database.');
    }
    console.log('✅ Verified Job was successfully created in PostgreSQL.');

    // 4. Try applying before approval (should fail)
    console.log('👉 Trying to apply PENDING_APPROVAL job (expecting failure)...');
    const applyFailResult = await client.callTool({
      name: 'aws_apply_resource_change',
      arguments: { jobId },
    }) as any;

    const applyFailData = JSON.parse(applyFailResult.content[0].text);
    if (!applyFailResult.isError || !applyFailData.error) {
      throw new Error('Expected apply to fail on unapproved job, but it succeeded.');
    }
    console.log('✅ Apply correctly rejected unapproved job with message:', applyFailData.error.message);

    // 5. Approve the job in the database (simulating the HQ Dashboard click)
    console.log('👉 Approving job in DB...');
    await prisma.awsResourceJob.update({
      where: { id: jobId },
      data: {
        status: 'APPROVED',
        approver: 'admin-verifier@launchpadphilly.org',
      },
    });
    console.log('✅ Job status set to APPROVED in Database.');

    // 6. Apply again (should succeed)
    console.log('👉 Re-applying approved job...');
    const applySuccessResult = await client.callTool({
      name: 'aws_apply_resource_change',
      arguments: { jobId },
    }) as any;

    const applySuccessData = JSON.parse(applySuccessResult.content[0].text);
    console.log('📦 Apply Tool Result Data:', applySuccessData);

    if (applySuccessResult.isError || applySuccessData.error) {
      throw new Error(`Apply failed: ${applySuccessData.error?.message || JSON.stringify(applySuccessData)}`);
    }
    console.log('✅ Apply executed successfully.');

    // 7. Verify final DB status
    const dbJobAfter = await prisma.awsResourceJob.findUnique({
      where: { id: jobId },
    });
    if (dbJobAfter?.status !== 'SUCCEEDED') {
      throw new Error(`Expected final DB status to be SUCCEEDED, got ${dbJobAfter?.status}`);
    }
    console.log('✅ Verified final Job status is SUCCEEDED in PostgreSQL.');

    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    // Cleanup server
    server.close();
    console.log('🛑 Server closed.');
  }
}

runTest().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
