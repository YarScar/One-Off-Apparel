'use server';

import { prisma } from '@lp-ai/lib-db';
import { revalidatePath } from 'next/cache';
import { auth } from '../../auth';
import { ROLES, type Role } from './roles';

async function assertAdmin(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) throw new Error('not_authenticated');
  const me = await prisma.mcpUser.findUnique({ where: { email } });
  if (!me || me.status !== 'ACTIVE' || !me.roles.includes('admin')) {
    throw new Error('not_authorized');
  }
  return email;
}

function parseEmail(formData: FormData): string {
  const v = formData.get('email');
  if (typeof v !== 'string' || !v) throw new Error('email_required');
  return v.toLowerCase();
}

function parseRoles(formData: FormData): Role[] {
  return formData
    .getAll('roles')
    .filter((v): v is string => typeof v === 'string')
    .filter((v): v is Role => (ROLES as readonly string[]).includes(v));
}

export async function promoteUser(formData: FormData): Promise<void> {
  await assertAdmin();
  const email = parseEmail(formData);
  const action = formData.get('action');

  if (action === 'activate') {
    await prisma.mcpUser.update({
      where: { email },
      data: { status: 'ACTIVE' },
    });
  } else if (action === 'set-roles') {
    const roles = parseRoles(formData);
    await prisma.mcpUser.update({
      where: { email },
      data: { roles },
    });
  }
  revalidatePath('/admin');
}

export async function disableUser(formData: FormData): Promise<void> {
  await assertAdmin();
  const email = parseEmail(formData);
  await prisma.mcpUser.update({
    where: { email },
    data: { status: 'DISABLED' },
  });
  // Revoke all outstanding refresh tokens for this user — they need to re-auth
  // and will fail at that point because account is disabled.
  await prisma.oAuthRefreshToken.updateMany({
    where: { userEmail: email, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath('/admin');
}

export async function deleteUser(formData: FormData): Promise<void> {
  const adminEmail = await assertAdmin();
  const email = parseEmail(formData);
  if (email === adminEmail) throw new Error('cannot_delete_self');

  // No FK constraints exist between mcp_users and the OAuth tables, but
  // dangling refresh tokens / auth codes are useless once the user is gone.
  // Clean them up in the same transaction.
  await prisma.$transaction([
    prisma.oAuthRefreshToken.deleteMany({ where: { userEmail: email } }),
    prisma.oAuthAuthorizationCode.deleteMany({ where: { userEmail: email } }),
    prisma.mcpUser.delete({ where: { email } }),
  ]);
  revalidatePath('/admin');
}

export async function addUser(formData: FormData): Promise<void> {
  await assertAdmin();
  const email = parseEmail(formData);
  const roles = parseRoles(formData);
  await prisma.mcpUser.upsert({
    where: { email },
    update: { status: 'ACTIVE', roles },
    create: { email, status: 'ACTIVE', roles },
  });
  revalidatePath('/admin');
}

/**
 * Toggle a single tool↔role cell in the matrix.
 * `next` is the new state ('true' to add, 'false' to remove).
 */
export async function toggleToolRole(formData: FormData): Promise<void> {
  await assertAdmin();
  const toolName = formData.get('toolName');
  const role = formData.get('role');
  const next = formData.get('next');
  if (typeof toolName !== 'string' || !toolName) throw new Error('tool_required');
  if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
    throw new Error('invalid_role');
  }

  const row = await prisma.toolPermission.findUnique({ where: { toolName } });
  if (!row) throw new Error('unknown_tool');

  const has = row.allowedRoles.includes(role);
  const shouldHave = next === 'true';
  if (has === shouldHave) {
    // no-op; just refresh
    revalidatePath('/admin');
    return;
  }

  const newRoles = shouldHave
    ? [...row.allowedRoles, role].sort()
    : row.allowedRoles.filter((r) => r !== role);

  await prisma.toolPermission.update({
    where: { toolName },
    data: { allowedRoles: newRoles },
  });
  revalidatePath('/admin');
}
