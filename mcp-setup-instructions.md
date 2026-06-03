### Updated Setup & Claude Configuration

With AWS App Runner deprecated as of April 2026, both MCP servers are deployed using **Amazon ECS Express Mode** as containerized Fargate tasks behind an Application Load Balancer.

> **TLS requirement.** All `MCP_URL` / `AWS_MCP_URL` values below use `https://` because bearer tokens travel in the `Authorization` header on every request. The ALB must terminate TLS via an ACM certificate on a `:443` HTTPS listener; a plain `:80` HTTP listener will leak credentials and must be either removed or set to redirect 80→443. If you bring up a fresh ALB, see `docs/setup/09-app-runner.md` for the listener + ACM steps.

### 1. Updated `aws-mcp.json` Configuration

```json
{
  "mcpServers": {
    "lp-internal-aws": {
      "command": "node",
      "args": [
        "/home/s4developer/engineering-projects/lp-internal-ai-v1/apps/mcp-server/dist/bridge.js"
      ],
      "env": {
        "MCP_URL": "https://ecs-express-gateway-alb-01c9106a-1205608538.us-east-1.elb.amazonaws.com/mcp",
        "SYNC_SECRET": "lpInc123!"
      }
    },
    "aws-resource-creator": {
      "command": "node",
      "args": [
        "/home/s4developer/engineering-projects/lp-internal-ai-v1/apps/aws-mcp-server/dist/bridge.js"
      ],
      "env": {
        "AWS_MCP_URL": "http://localhost:8081/mcp",
        "AWS_MCP_TOKEN": "lpInc123!"
      }
    },
    "aws-agent-toolkit": {
      "command": "uvx",
      "args": [
        "mcp-proxy-for-aws@latest",
        "https://aws-mcp.us-east-1.api.aws/mcp",
        "--metadata",
        "AWS_REGION=us-east-1"
      ]
    }
  }
}
```

---
> Linux: ~/.config/Claude/config.json
> macOS: ~/Library/Application Support/Claude/claude_desktop_config.json

### 2. Windows Claude Desktop Configuration

>  Claude Desktop on Windows can use MCP servers via the following configuration:

#### 1. Configuration File Location
Open the following path in File Explorer or your text editor:
* **Short Path**: `%APPDATA%\Claude\claude_desktop_config.json`
* **Full Path**: `C:\Users\<YourUsername>\AppData\Roaming\Claude\claude_desktop_config.json`

#### 2. JSON Configuration (Windows Syntax)
In Windows JSON configuration files, you must escape backslashes using `\\` or use forward slashes `/`. Here is the Windows configuration:

```json
{
  "mcpServers": {
    "lp-internal-aws": {
      "command": "node",
      "args": [
        "C:\\Users\\<YourUsername>\\engineering-projects\\lp-internal-ai-v1\\apps\\mcp-server\\dist\\bridge.js"
      ],
      "env": {
        "MCP_URL": "https://ecs-express-gateway-alb-01c9106a-1205608538.us-east-1.elb.amazonaws.com/mcp",
        "SYNC_SECRET": "lpInc123!"
      }
    },
    "aws-resource-creator": {
      "command": "node",
      "args": [
        "C:\\Users\\<YourUsername>\\engineering-projects\\lp-internal-ai-v1\\apps\\aws-mcp-server\\dist\\bridge.js"
      ],
      "env": {
        "AWS_MCP_URL": "http://localhost:8081/mcp",
        "AWS_MCP_TOKEN": "lpInc123!"
      }
    },
    "aws-agent-toolkit": {
      "command": "uvx",
      "args": [
        "mcp-proxy-for-aws@latest",
        "https://aws-mcp.us-east-1.api.aws/mcp",
        "--metadata",
        "AWS_REGION=us-east-1"
      ]
    }
  }
}
```
*(Replace `<YourUsername>` and the workspace path to match the target machine's Windows path).*

---

### 3. Next Steps (Running the Services)

1. **Build all dependencies**:
   ```bash
   pnpm install
   pnpm --filter @lp-ai/mcp-server build
   pnpm --filter @lp-ai/aws-mcp-server build
   ```

2. **Run Main Data Server**:
   The `lp-internal-aws` server routes requests over HTTPS to the Application Load Balancer deployed via **ECS Express Mode**. As long as your ECS service is running on AWS, no local server execution is required.

3. **Run AWS Resource Creator Server**:
   * **Local Development**: Spin up the local HTTP listener on port `8081`:
     ```bash
     pnpm --filter @lp-ai/aws-mcp-server dev:http
     ```
   * **Production Deployment**: Once the infrastructure server is also deployed to Amazon ECS Express Mode, update the `AWS_MCP_URL` in the config file to point to the new ECS ALB DNS address instead of `localhost`.

4. **Run Official Amazon AWS Agent Toolkit**:
   * **Install `uv` (Prerequisite)**: The AWS MCP proxy server runs via Python and is launched with `uvx`. Ensure `uv` is installed on your machine:
     ```bash
     # Linux / macOS
     curl -LsSf https://astral.sh/uv/install.sh | sh
     ```
   * **Configure AWS Credentials**: Ensure you have logged in or set up your local AWS credentials via the AWS CLI:
     ```bash
     aws sso login --profile dev
     # or standard credentials setup
     ```
   * The proxy server will launch automatically when Claude starts, proxying standard input/output requests to Amazon's secure, remote AWS MCP API.

## Verification & Troubleshooting Checklist

### Verify Health Check Endpoint
Query the service health endpoint from your local terminal (no authentication required):
```bash
curl https://<your-alb-dns-name>.amazonaws.com/health
```
**Expected Response**:
```json
{
  "status": "ok",
  "ts": "2026-05-28T12:00:00.000Z"
}
```
*If this returns a 503 or 504 error, check your security group settings to ensure the ALB can reach your Fargate task on port 8080, and that the Fargate task has outbound access to resolve and query the RDS Postgres instance.*

### Verify Authentication
Verify that `/mcp` endpoints reject unauthenticated calls:
```bash
curl -X POST https://<your-alb-dns-name>.amazonaws.com/mcp
```
**Expected Response**:
```json
{
  "error": "unauthorized"
}
```

Verify that tool queries work when using the `SYNC_SECRET` token:
```bash
curl -X POST https://<your-alb-dns-name>.amazonaws.com/mcp \
  -H "Authorization: Bearer <your-sync-secret>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
**Expected Response**: A JSON-RPC body returning the full schema for all 15 MCP tools.

### Viewing Fargate Container Logs
Review application logs in **Amazon CloudWatch Logs**:
- Log Group: `/ecs/lp-internal-mcp-service`
- Log Stream: `ecs/...`
Look for Prisma connection errors or Secrets Manager decryption issues if the health check fails.


