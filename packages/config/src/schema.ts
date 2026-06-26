import { z } from 'zod';

const optional = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().min(1).optional(),
);
const required = z.string().trim().min(1);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  USE_AWS_SECRETS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AWS_PROFILE: optional,
  AWS_REGION: z.string().trim().min(1).default('us-east-1'),
  AWS_SECRETS_PREFIX: z.string().trim().min(1).default('lp-internal'),

  DATABASE_URL: required,

  ANTHROPIC_API_KEY: optional,
  OPENAI_API_KEY: optional,

  GOOGLE_SERVICE_ACCOUNT_JSON: optional,
  GOOGLE_DRIVE_FOLDER_ID: optional,
  GOOGLE_SHEETS_STUDENT_INFO_ID: optional,
  GOOGLE_SHEETS_STUDENT_INFO_V2: optional,
  GOOGLE_SHEETS_DASHBOARD_ID: optional,
  GOOGLE_SHEETS_PHASE_DASHBOARD_ID: optional,
  GOOGLE_SHEETS_BY_PHASE_Q3_2026_ACTUALS: optional,
  GOOGLE_SHEETS_BUDGET_BY_PHASE_ACTUALS_2025: optional,
  GOOGLE_SHEETS_RAPID: optional,
  GOOGLE_SHEETS_PEX: optional,
  GOOGLE_SHEETS_STUDENT_COMPETENCY: optional,
  GOOGLE_SHEETS_DEVELOPMENT_CRM: optional,
  GOOGLE_SHEETS_ATTENDANCE_COHORT_1: optional,
  GOOGLE_SHEETS_ATTENDANCE_COHORT_1_101: optional,
  GOOGLE_SHEETS_ATTENDANCE_COHORT_1_LIFTOFF: optional,
  GOOGLE_SHEETS_ATTENDANCE_COHORT_2: optional,
  GOOGLE_SHEETS_ATTENDANCE_COHORT_3: optional,
  GOOGLE_SHEETS_FINANCE_WORKBOOK: optional,

  BIGQUERY_PROJECT_ID: z.string().trim().min(1).default('lp-internal-ai'),
  BIGQUERY_DATASET: optional,

  APLOS_CLIENT_ID: optional,
  APLOS_API_KEY: optional,
  SLACK_BOT_TOKEN: optional,
  SLACK_SIGNING_SECRET: optional,
  ROAM_API_KEY: optional,
  ROAM_GRAPH_NAME: optional,

  NOTION_API_KEY: optional,
  NOTION_MEETING_TRANSCRIPTS_DB_ID: optional,
  NOTION_WEBHOOK_SECRET: optional, // verification token for the HQ meeting-router webhook signature
  NOTION_PEOPLE_DB_ID: optional, // People & Entities database id — for attendee→People linking (query by Email)
  NOTION_SYNC_DATABASE_IDS: optional, // comma-separated "id:Name" pairs for generic Notion DB sync

  AUTH_SECRET: optional,
  AUTH_GOOGLE_ID: optional,
  AUTH_GOOGLE_SECRET: optional,
  AUTH_ALLOWED_DOMAIN: z.string().trim().min(1).default('launchpadphilly.org,b-21.org'),

  SENTRY_DSN_HQ: optional,
  SENTRY_DSN_MCP: optional,
  SENTRY_ORG: optional,
  SENTRY_PROJECT_HQ: optional,
  SENTRY_PROJECT_MCP: optional,

  SYNC_SECRET: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(32, 'SYNC_SECRET must be at least 32 characters').optional(),
  ),

  // MCP OAuth (Phase 23). Active on the MCP servers in production; ignored locally.
  // AWS MCP server runtime flags
  MOCK_TERRAFORM: optional,   // 'false' to use real terraform; default mock
  AWS_ENV: optional,          // 'production' enables governance gates
  AUTO_APPLY_DEV: optional,   // 'true' auto-approves non-destructive dev changes

  MCP_OAUTH_ISSUER: optional, // e.g. https://mcp.launchpadinc.org
  MCP_PUBLIC_URL: optional, // resource URL advertised in /.well-known/oauth-protected-resource
  AWS_MCP_PUBLIC_URL: optional, // resource URL for the AWS MCP server
  JWT_PRIVATE_KEY: optional, // RSA PEM, signs MCP access tokens
  JWT_KID: optional, // key ID exposed in JWKS
});

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;
