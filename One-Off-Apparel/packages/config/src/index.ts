import { envSchema, type Env } from './schema.js';
import { loadSecrets } from './secrets.js';

let cached: Env | undefined;

export async function loadEnv(): Promise<Env> {
  if (cached) return cached;

  const useAwsSecrets = process.env['USE_AWS_SECRETS'] === 'true';
  const source: Record<string, string | undefined> = { ...process.env };

  if (useAwsSecrets) {
    const region = process.env['AWS_REGION'] ?? 'us-east-1';
    const prefix = process.env['AWS_SECRETS_PREFIX'] ?? 'lp-internal';
    const profile = process.env['AWS_PROFILE'];
    const secrets = await loadSecrets({ region, prefix, profile });
    for (const [key, value] of Object.entries(secrets)) {
      source[key] = value;
    }
  }

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;

  // Propagate parsed configuration back to process.env
  for (const [key, value] of Object.entries(cached)) {
    if (value !== undefined) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else if (typeof value === 'boolean') {
        process.env[key] = value ? 'true' : 'false';
      } else {
        process.env[key] = String(value);
      }
    }
  }

  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export type { Env, EnvKey } from './schema.js';
export { envSchema } from './schema.js';
