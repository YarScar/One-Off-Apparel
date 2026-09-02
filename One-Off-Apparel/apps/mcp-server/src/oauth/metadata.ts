/**
 * OAuth 2.0 discovery metadata (RFC 9728 + RFC 8414).
 * Static JSON responses; URLs derived from MCP_OAUTH_ISSUER.
 */

import { loadEnv } from '@lp-ai/lib-config';

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource_documentation?: string;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  jwks_uri: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

export async function protectedResourceMetadata(): Promise<ProtectedResourceMetadata> {
  const env = await loadEnv();
  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  const resource = env.MCP_PUBLIC_URL ?? issuer;
  return {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/ckunkel/lp-internal-ai-v1/blob/master/docs/setup/23-mcp-oauth.md',
  };
}

export async function authorizationServerMetadata(): Promise<AuthorizationServerMetadata> {
  const env = await loadEnv();
  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: ['mcp:tools'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  };
}
