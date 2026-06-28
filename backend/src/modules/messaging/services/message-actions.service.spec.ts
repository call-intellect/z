import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IntakeService } from '../../tracker/services/intake.service';

import { MessageActionsService } from './message-actions.service';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    tenantId: 'org-1',
    content: 'gcm:v1:надо обновить лендинг к пятнице',
    voiceTranscript: null,
    authorUserId: 'author-1',
    deletedAt: null,
    ...overrides,
  };
}

function build(opts: {
  member?: { id: string } | null;
  message?: Record<string, unknown> | null;
  person?: { id: string } | null;
}) {
  const createIntake = vi.fn().mockResolvedValue({ id: 'intake-1' });
  const createDecision = vi.fn().mockResolvedValue({ id: 'dec-1' });

  const prisma = {
    conversationMember: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.member === undefined ? { id: 'm-1' } : opts.member),
    },
    message: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.message === null ? null : makeMessage(opts.message ?? {})),
    },
    person: {
      findFirst: vi
        .fn()
        .mockResolvedValue(opts.person === undefined ? { id: 'person-1' } : opts.person),
    },
    decision: { create: createDecision },
  } as unknown as PrismaService;

  const crypto = {
    decrypt: vi.fn((v: string) => v.replace(/^gcm:v1:/, '')),
  } as unknown as CryptoService;

  const intake = { create: createIntake } as unknown as IntakeService;

  const service = new MessageActionsService(prisma, crypto, intake);
  return { service, createIntake, createDecision };
}

describe('MessageActionsService.messageToTask', () => {
  it('создаёт intake source=chat с provenance externalId=msg:<id>, возвращает issueId', async () => {
    const { service, createIntake } = build({ member: { id: 'm-1' } });

    const res = await service.messageToTask({
      tenantId: 'org-1',
      userId: 'u-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
    });

    expect(res.issueId).toBe('intake-1');
    expect(createIntake).toHaveBeenCalledTimes(1);
    const [dto, tenantId] = createIntake.mock.calls[0]!;
    expect(tenantId).toBe('org-1');
    expect(dto.source).toBe('chat');
    expect(dto.externalSource).toBe('chat');
    expect(dto.externalId).toBe('msg:msg-1');
    expect(dto.rawContent).toContain('лендинг');
    expect(dto.suggestedAssigneeId).toBe('author-1');
  });

  it('не член → 403', async () => {
    const { service, createIntake } = build({ member: null });

    await expect(
      service.messageToTask({
        tenantId: 'org-1',
        userId: 'u-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createIntake).not.toHaveBeenCalled();
  });

  it('сообщение не найдено → 404', async () => {
    const { service } = build({ member: { id: 'm-1' }, message: null });

    await expect(
      service.messageToTask({
        tenantId: 'org-1',
        userId: 'u-1',
        conversationId: 'conv-1',
        messageId: 'msg-x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MessageActionsService.messageToDecision', () => {
  it('создаёт Decision(status=proposed) с provenance messageId', async () => {
    const { service, createDecision } = build({ member: { id: 'm-1' }, person: { id: 'person-1' } });

    const res = await service.messageToDecision({
      tenantId: 'org-1',
      userId: 'u-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
    });

    expect(res.decisionId).toBe('dec-1');
    const data = createDecision.mock.calls[0]![0].data;
    expect(data.status).toBe('proposed');
    expect(data.tenantId).toBe('org-1');
    expect(data.statement).toContain('лендинг');
    expect(data.decidedByPersonIds).toEqual(['person-1']);
    expect(data.previewSourceRef.messageId).toBe('msg-1');
    expect(data.previewSourceRef.sourceExternalId).toBe('msg:msg-1');
  });

  it('автор без Person → decidedByPersonIds пуст', async () => {
    const { service, createDecision } = build({ member: { id: 'm-1' }, person: null });

    await service.messageToDecision({
      tenantId: 'org-1',
      userId: 'u-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
    });

    expect(createDecision.mock.calls[0]![0].data.decidedByPersonIds).toEqual([]);
  });

  it('не член → 403', async () => {
    const { service, createDecision } = build({ member: null });

    await expect(
      service.messageToDecision({
        tenantId: 'org-1',
        userId: 'u-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createDecision).not.toHaveBeenCalled();
  });
});
