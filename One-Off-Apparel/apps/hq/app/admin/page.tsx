import { prisma } from '@lp-ai/lib-db';
import { redirect } from 'next/navigation';
import { auth } from '../../auth';
import { promoteUser, disableUser, deleteUser, addUser } from './actions';
import { DeleteUserButton } from './DeleteUserButton';
import { ROLES } from './roles';
import { PermissionsMatrix } from './PermissionsMatrix';

export const dynamic = 'force-dynamic';

interface McpUserRow {
  email: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  roles: string[];
  createdAt: Date;
  lastLogin: Date | null;
}

async function fetchUsers(): Promise<McpUserRow[]> {
  const rows = await prisma.mcpUser.findMany({
    orderBy: [{ status: 'asc' }, { lastLogin: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map((r) => ({
    email: r.email,
    status: r.status,
    roles: r.roles,
    createdAt: r.createdAt,
    lastLogin: r.lastLogin,
  }));
}

async function currentUserIsAdmin(): Promise<boolean> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return false;
  const me = await prisma.mcpUser.findUnique({
    where: { email: email.toLowerCase() },
  });
  return me?.status === 'ACTIVE' && me.roles.includes('admin');
}

function StatusBadge({ status }: { status: McpUserRow['status'] }) {
  const cls =
    status === 'ACTIVE'
      ? 'bg-green-50 text-green-700'
      : status === 'PENDING'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-red-50 text-red-700';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${cls}`}>{status}</span>
  );
}

export default async function AdminPage() {
  if (!(await currentUserIsAdmin())) {
    redirect('/');
  }
  const users = await fetchUsers();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">MCP user admin</h1>
        <p className="mt-1 text-sm text-muted">
          Manage who can use the LP Internal AI MCP server from Claude. Promote
          new sign-ins from <code>PENDING</code> → <code>ACTIVE</code> and assign roles.
          Roles control which tools they can call (see{' '}
          <a className="underline" href="https://github.com/ckunkel/lp-internal-ai-v1/blob/master/docs/setup/23-mcp-oauth.md">
            docs/setup/23-mcp-oauth.md
          </a>{' '}
          for the tool ↔ role matrix).
        </p>
      </header>

      <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Roles</th>
              <th className="px-4 py-2">Last login</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">
                  No users yet. The first sign-in via Anthropic Console will land here as PENDING.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.email} className="border-t align-top">
                <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={u.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 && (
                      <span className="text-xs text-muted">(none)</span>
                    )}
                    {u.roles.map((r) => (
                      <span
                        key={r}
                        className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {u.lastLogin ? u.lastLogin.toISOString().slice(0, 19) + 'Z' : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {u.status !== 'ACTIVE' && (
                      <form action={promoteUser}>
                        <input type="hidden" name="email" value={u.email} />
                        <button
                          type="submit"
                          className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50"
                          name="action"
                          value="activate"
                        >
                          Activate
                        </button>
                      </form>
                    )}
                    <form action={promoteUser} className="flex items-center gap-1">
                      <input type="hidden" name="email" value={u.email} />
                      <input
                        type="hidden"
                        name="action"
                        value="set-roles"
                      />
                      <select
                        name="roles"
                        multiple
                        defaultValue={u.roles}
                        className="rounded border bg-white px-1 py-0.5 text-xs"
                        size={4}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Save roles
                      </button>
                    </form>
                    {u.status !== 'DISABLED' && (
                      <form action={disableUser}>
                        <input type="hidden" name="email" value={u.email} />
                        <button
                          type="submit"
                          className="rounded border bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          Disable
                        </button>
                      </form>
                    )}
                    <DeleteUserButton email={u.email} action={deleteUser} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Add a user manually
        </h2>
        <p className="mt-1 text-xs text-muted">
          Pre-create an active row before the person signs in. They&apos;ll be able to
          complete the OAuth flow without needing your promote step.
        </p>
        <form action={addUser} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="email"
            type="email"
            placeholder="someone@launchpadphilly.org"
            required
            className="rounded border px-2 py-1 text-sm"
          />
          <select
            name="roles"
            multiple
            defaultValue={['program_staff']}
            className="rounded border bg-white px-1 py-0.5 text-sm"
            size={4}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-ink px-3 py-1.5 text-sm text-white hover:opacity-90"
          >
            Add user
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <header>
          <h2 className="text-lg font-semibold text-ink">Tool permissions</h2>
          <p className="text-sm text-muted">
            Each cell is a toggle. Adding a role to a row lets users with that role
            call the tool from Claude. Removing a role denies them.
            Changes propagate to the running MCP server within{' '}
            <strong>~60 seconds</strong> (the server caches this table).
          </p>
        </header>
        <PermissionsMatrix />
      </section>
    </div>
  );
}
