import NextAuth from 'next-auth';
import authConfig from './auth.config';
import { NextResponse } from 'next/server';

// '/api/notion/meeting-router' is the Notion webhook receiver — Notion calls it
// unauthenticated, so it's verified by signature inside the route, not by session auth.
const PUBLIC_PATHS = ['/auth/signin', '/api/auth', '/api/health', '/api/notion/meeting-router'];

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }
  if (process.env.NODE_ENV === 'development' && process.env.HQ_DEV_NO_AUTH === 'true') {
    return NextResponse.next();
  }
  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/signin';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
