import * as Sentry from '@sentry/nextjs';

if (process.env['SENTRY_DSN_HQ']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN_HQ'],
    environment: process.env['NODE_ENV'],
    tracesSampleRate: 0.1,
  });
}
