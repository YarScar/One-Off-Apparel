import { describe, it, expect, beforeEach } from 'vitest';
import {
  canCallTool,
  isRole,
  __setPermissionsForTesting,
  __clearPermissionsCacheForTesting,
} from './permissions.js';

const STUB = {
  query_students: ['program_staff', 'leadership', 'admin'],
  query_donors: ['development', 'sales', 'finance', 'leadership', 'admin'],
  query_finances: ['finance', 'leadership', 'admin'],
  get_entity_brief: ['development', 'sales', 'leadership', 'admin'],
  query_hubspot_contacts: ['sales', 'leadership', 'admin'],
};

describe('permissions registry (DB-backed with test stubs)', () => {
  beforeEach(() => {
    __clearPermissionsCacheForTesting();
    __setPermissionsForTesting(STUB);
  });

  it('admin can call every stubbed tool', async () => {
    for (const tool of Object.keys(STUB)) {
      expect(await canCallTool(tool, ['admin'])).toBe(true);
    }
  });

  it('leadership can call every stubbed tool', async () => {
    for (const tool of Object.keys(STUB)) {
      expect(await canCallTool(tool, ['leadership'])).toBe(true);
    }
  });

  it('pending users cannot call anything', async () => {
    expect(await canCallTool('query_students', ['pending'])).toBe(false);
    expect(await canCallTool('query_donors', ['pending'])).toBe(false);
  });

  it('empty roles cannot call anything', async () => {
    expect(await canCallTool('query_students', [])).toBe(false);
  });

  it('program_staff has student access but not donor access', async () => {
    expect(await canCallTool('query_students', ['program_staff'])).toBe(true);
    expect(await canCallTool('query_donors', ['program_staff'])).toBe(false);
  });

  it('sales has donor + entity access but no student access', async () => {
    expect(await canCallTool('query_donors', ['sales'])).toBe(true);
    expect(await canCallTool('get_entity_brief', ['sales'])).toBe(true);
    expect(await canCallTool('query_students', ['sales'])).toBe(false);
  });

  it('finance has finance + donor access but no student access', async () => {
    expect(await canCallTool('query_finances', ['finance'])).toBe(true);
    expect(await canCallTool('query_donors', ['finance'])).toBe(true);
    expect(await canCallTool('query_students', ['finance'])).toBe(false);
  });

  it('multi-role user gets union of allowed tools', async () => {
    expect(await canCallTool('query_students', ['program_staff', 'sales'])).toBe(true);
    expect(await canCallTool('query_donors', ['program_staff', 'sales'])).toBe(true);
  });

  it('unknown tools deny by default', async () => {
    expect(await canCallTool('not_a_real_tool', ['admin'])).toBe(false);
  });

  it('future tools (HubSpot/etc) work the same as current tools', async () => {
    expect(await canCallTool('query_hubspot_contacts', ['sales'])).toBe(true);
    expect(await canCallTool('query_hubspot_contacts', ['program_staff'])).toBe(false);
  });

  it('isRole gates correctly', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('program_staff')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
  });
});
