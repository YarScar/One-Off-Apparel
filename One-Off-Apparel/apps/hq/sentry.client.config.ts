import * as Sentry from '@sentry/nextjs';

if (process.env['NEXT_PUBLIC_SENTRY_DSN_HQ']) {
  Sentry.init({
    dsn: process.env['NEXT_PUBLIC_SENTRY_DSN_HQ'],
    environment: process.env['NODE_ENV'],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
