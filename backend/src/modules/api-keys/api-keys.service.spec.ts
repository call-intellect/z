import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { AuditLogService } from '../audit/audit-log.service';

import { ApiKeysService, sha256 } from './api-keys.service';
import type { ApiKeysRepository } from './api-keys.repository';

function makeCfg(maxApiKeys = 10): TypedConfigService {
  return {
    workspace: { maxApiKeysPerUser: maxApiKeys },
  } as unknown as TypedConfigService;
}

function makeAudit(): AuditLogService {
  return { log: vi.fn(async () => undefined) } as unknown as AuditLogService;
}

describe('ApiKeysService.create', () => {
  it('генерирует z_-prefixed ключ, hash и prefix', async () => {
    const created: Array<Record<string, unknown>> = [];
    const repo = {
      countActive: vi.fn(async () => 0),
      create: vi.fn(async (input: Record<string, unknown>) => {
        created.push(input);
        return { id: 'k1', name: input.name, prefix: input.prefix, scopes: input.scopes };
      }),
    } as unknown as ApiKeysRepository;

    const svc = new ApiKeysService(repo, makeCfg(), makeAudit());
    const out = await svc.create('u1', { name: 'test', scopes: ['read'] });

    expect(out.rawKey.startsWith('z_')).toBe(true);
    expect(out.rawKey.length).toBeGreaterThan(20);
    const stored = created[0]!;
    expect(stored.hashedKey).toBe(sha256(out.rawKey));
    expect(stored.prefix).toBe(out.rawKey.slice(0, 10));
  });

  it('лимит достигнут → BadRequest', async () => {
    const repo = {
      countActive: vi.fn(async () => 10),
      create: vi.fn(),
    } as unknown as ApiKeysRepository;
    const svc = new ApiKeysService(repo, makeCfg(10), makeAudit());
    await expect(
      svc.create('u1', { name: 'x', scopes: ['read'] }),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        error: { code: 'api_keys_limit_reached' },
      },
    });
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('ApiKeysService.resolveByRawKey', () => {
  it('hash сопоставляется правильно', async () => {
    const raw = 'z_abc123';
    const stored = {
      id: 'k1',
      userId: 'u1',
      hashedKey: createHash('sha256').update(raw).digest('hex'),
      revokedAt: null,
    };
    const repo = {
      findByHashed: vi.fn(async (h: string) => (h === stored.hashedKey ? stored : null)),
    } as unknown as ApiKeysRepository;
    const svc = new ApiKeysService(repo, makeCfg(), makeAudit());
    const r = await svc.resolveByRawKey(raw);
    expect(r?.id).toBe('k1');
  });

  it('revoked → null', async () => {
    const raw = 'z_x';
    const repo = {
      findByHashed: vi.fn(async () => ({ id: 'k', revokedAt: new Date() })),
    } as unknown as ApiKeysRepository;
    const svc = new ApiKeysService(repo, makeCfg(), makeAudit());
    expect(await svc.resolveByRawKey(raw)).toBeNull();
  });
});
