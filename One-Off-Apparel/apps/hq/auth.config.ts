import Google from 'next-auth/providers/google';
import type { NextAuthConfig } from 'next-auth';

// Comma-separated list of allowed email domains. Single domain still works
// (backward compatible). Empty values are skipped, whitespace trimmed.
const ALLOWED_DOMAINS = (process.env['AUTH_ALLOWED_DOMAIN'] ?? 'launchpadphilly.org')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export default {
  trustHost: true,
  providers: [
    Google({
      clientId: process.env['AUTH_GOOGLE_ID'] ?? '',
      clientSecret: process.env['AUTH_GOOGLE_SECRET'] ?? '',
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      const email = (profile?.email ?? '').toLowerCase();
      return ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`));
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
} satisfies NextAuthConfig;
