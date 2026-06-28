import { createHash } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AccessLinkService } from './access-link.service';

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function build(linkRow: unknown) {
  const create = vi.fn().mockResolvedValue({ id: 'link-1' });
  const findUnique = vi.fn().mockResolvedValue(linkRow);
  const prisma = {
    conversationAccessLink: { create, findUnique },
  } as unknown as PrismaService;
  const cfg = {
    getDynamic: vi.fn().mockResolvedValue(168),
    publicHostUrl: 'https://app.kora.test',
  } as unknown as TypedConfigService;
  const service = new AccessLinkService(prisma, cfg);
  return { service, create, findUnique };
}

describe('AccessLinkService.createLink', () => {
  it('хранит ХЭШ токена, а не сырой; возвращает сырой токен один раз + url', async () => {
    const { service, create } = build(null);
    const result = await service.createLink({
      conversationId: 'conv-1',
      createdByUserId: 'staff-1',
      contactEmail: 'c@example.com',
    });

    expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.url).toBe(`https://app.kora.test/c/${result.rawToken}`);

    const data = create.mock.calls[0]![0].data;
    expect(data.tokenHash).toBe(sha256(result.rawToken));
    expect(data.tokenHash).not.toBe(result.rawToken);
    expect(JSON.stringify(data)).not.toContain(result.rawToken);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });
});

describe('AccessLinkService.verifyToken', () => {
  it('валидный токен → ok', async () => {
    const raw = 'a'.repeat(64);
    const { service } = build({
      id: 'link-1',
      tokenHash: sha256(raw),
      conversationId: 'conv-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await service.verifyToken(raw);
    expect(res.conversationId).toBe('conv-1');
    expect(res.accessLink.id).toBe('link-1');
  });

  it('невалидный (не найден) → 403 ACCESS_LINK_INVALID', async () => {
    const { service } = build(null);
    await expect(service.verifyToken('nope')).rejects.toMatchObject({
      response: { error: { code: 'ACCESS_LINK_INVALID' } },
    });
    await expect(service.verifyToken('nope')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('отозванный → 403 ACCESS_LINK_REVOKED', async () => {
    const raw = 'b'.repeat(64);
    const { service } = build({
      id: 'link-1',
      tokenHash: sha256(raw),
      conversationId: 'conv-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.verifyToken(raw)).rejects.toMatchObject({
      response: { error: { code: 'ACCESS_LINK_REVOKED' } },
    });
  });

  it('просроченный → 403 ACCESS_LINK_EXPIRED', async () => {
    const raw = 'c'.repeat(64);
    const { service } = build({
      id: 'link-1',
      tokenHash: sha256(raw),
      conversationId: 'conv-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(service.verifyToken(raw)).rejects.toMatchObject({
      response: { error: { code: 'ACCESS_LINK_EXPIRED' } },
    });
  });
});
