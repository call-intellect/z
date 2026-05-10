import { describe, expect, it } from 'vitest';

import { mapAccountUserDtoToDomain } from '../account';
import type { AccountUserApi } from '@/api/types/accounts';

describe('mapAccountUserDtoToDomain', () => {
  const baseDto: AccountUserApi = {
    id: 'usr_123',
    email: 'alice@z.app',
    name: 'Alice',
    role: 'user',
    signupSource: 'standalone',
    mustChangePassword: false,
    createdAt: '2026-05-09T10:30:00.000Z',
    isSuperAdmin: false,
    currentOrgRole: null,
    currentOrgId: null,
  };

  it('преобразует createdAt в Date', () => {
    const out = mapAccountUserDtoToDomain(baseDto);
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.createdAt.toISOString()).toBe('2026-05-09T10:30:00.000Z');
  });

  it('сохраняет идентификатор, email, name, role без изменений', () => {
    const out = mapAccountUserDtoToDomain(baseDto);
    expect(out.id).toBe('usr_123');
    expect(out.email).toBe('alice@z.app');
    expect(out.name).toBe('Alice');
    expect(out.role).toBe('user');
  });

  it('пробрасывает signupSource и mustChangePassword', () => {
    const out = mapAccountUserDtoToDomain({
      ...baseDto,
      signupSource: 'crossmark',
      mustChangePassword: true,
    });
    expect(out.signupSource).toBe('crossmark');
    expect(out.mustChangePassword).toBe(true);
  });

  it('обрабатывает admin role', () => {
    const out = mapAccountUserDtoToDomain({ ...baseDto, role: 'admin' });
    expect(out.role).toBe('admin');
  });
});
