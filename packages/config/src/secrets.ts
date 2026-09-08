import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const SECRET_GROUPS = [
  'db',
  'anthropic',
  'openai',
  'google',
  'nextauth',
  'aplos',
  'notion',
  'slack',
  'roam',
  'sync',
  'sentry',
] as const;

type SecretGroup = (typeof SECRET_GROUPS)[number];

export interface SecretsLoaderOptions {
  region: string;
  prefix: string;
  profile?: string | undefined;
}

export async function loadSecrets(
  options: SecretsLoaderOptions,
): Promise<Record<string, string>> {
  const client = new SecretsManagerClient({ region: options.region });
  const merged: Record<string, string> = {};

  await Promise.all(
    SECRET_GROUPS.map(async (group) => {
      const id = `${options.prefix}/${group}`;
      const result = await fetchSecret(client, id, group);
      Object.assign(merged, result);
    }),
  );

  return merged;
}

async function fetchSecret(
  client: SecretsManagerClient,
  id: string,
  group: SecretGroup,
): Promise<Record<string, string>> {
  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: id }));
    const raw = response.SecretString;
    if (!raw) {
      throw new Error(`Secret ${id} has no SecretString`);
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Secret ${id} is not a JSON object`);
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') {
        throw new Error(`Secret ${id} key ${key} is not a string (group=${group})`);
      }
      out[key] = value;
    }
    return out;
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      console.warn(`[Config] Optional secret group '${group}' (${id}) not found in Secrets Manager. Skipping.`);
      return {};
    }
    throw error;
  }
}
