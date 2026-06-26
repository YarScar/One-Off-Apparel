import { describe, expect, it } from 'vitest';
import { envSchema } from './schema.js';

describe('envSchema', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://u:p@h:5432/d',
  };

  it('parses a minimal valid environment (only DATABASE_URL required)', () => {
    const result = envSchema.parse(validBase);
    expect(result.DATABASE_URL).toBe('postgresql://u:p@h:5432/d');
    expect(result.NODE_ENV).toBe('development');
    expect(result.USE_AWS_SECRETS).toBe(false);
    expect(result.AWS_REGION).toBe('us-east-1');
    expect(result.AWS_SECRETS_PREFIX).toBe('lp-internal');
    expect(result.AUTH_ALLOWED_DOMAIN).toBe('launchpadphilly.org,b-21.org');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it('coerces USE_AWS_SECRETS=true to boolean', () => {
    const result = envSchema.parse({ ...validBase, USE_AWS_SECRETS: 'true' });
    expect(result.USE_AWS_SECRETS).toBe(true);
  });

  it('rejects missing DATABASE_URL', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty DATABASE_URL', () => {
    const result = envSchema.safeParse({ ...validBase, DATABASE_URL: '' });
    expect(result.success).toBe(false);
  });

  it('treats blank optional fields as omitted', () => {
    const result = envSchema.parse({
      ...validBase,
      OPENAI_API_KEY: '',
      NOTION_API_KEY: '',
    });
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.NOTION_API_KEY).toBeUndefined();
  });
});
