import Link from 'next/link';
import type { JSX } from 'react';
import { auth, signIn, signOut } from '@/auth';

export async function Nav(): Promise<JSX.Element> {
  const session = await auth();

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
            One Off Apparel
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted">
            <Link href="/" className="hover:text-ink">
              Home
            </Link>
            <Link href="/orders" className="hover:text-ink">
              Orders
            </Link>
          </nav>
        </div>
        <div className="text-sm text-muted">
          {session?.user ? (
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/auth/signin' });
              }}
              className="flex items-center gap-3"
            >
              <span>{session.user.email}</span>
              <button type="submit" className="rounded border px-2 py-1 hover:bg-slate-100">
                Sign out
              </button>
            </form>
          ) : (
            <form
              action={async () => {
                'use server';
                await signIn('google');
              }}
            >
              <button type="submit" className="rounded border px-2 py-1 hover:bg-slate-100">
                Sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
