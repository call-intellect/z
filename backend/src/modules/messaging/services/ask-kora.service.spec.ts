import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ChatV2OrchestrationService } from '../../chat-v2/chat-v2.service';

import { AskKoraService } from './ask-kora.service';

function build(opts: {
  member?: { id: string } | null;
  chatV2Enabled?: boolean;
  ephemeral?: {
    text: string;
    citations: unknown[];
    usedBlockIds: string[];
  };
  evidenceRows?: Array<{ rawEvent: { sourceExternalId: string | null } | null }>;
}) {
  const askEphemeral = vi.fn().mockResolvedValue(
    opts.ephemeral ?? { text: 'ответ', citations: [{ id: 'c1' }], usedBlockIds: ['block-1'] },
  );
  const evidenceFindMany = vi.fn().mockResolvedValue(opts.evidenceRows ?? []);

  const prisma = {
    conversationMember: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.member === undefined ? { id: 'm-1' } : opts.member),
    },
    ideaBlockEvidence: { findMany: evidenceFindMany },
  } as unknown as PrismaService;

  const cfg = {
    knowledgeCore: { chatV2Enabled: opts.chatV2Enabled ?? true },
  } as unknown as TypedConfigService;

  const chatV2 = { askEphemeral } as unknown as ChatV2OrchestrationService;

  const service = new AskKoraService(prisma, cfg, chatV2);
  return { service, askEphemeral, evidenceFindMany };
}

describe('AskKoraService.ask', () => {
  it('проксирует chat-v2.askEphemeral со scope=org', async () => {
    const { service, askEphemeral } = build({ member: { id: 'm-1' } });

    await service.ask({
      tenantId: 'org-1',
      userId: 'u-1',
      conversationId: 'conv-1',
      question: 'что решили?',
    });

    expect(askEphemeral).toHaveBeenCalledTimes(1);
    const arg = askEphemeral.mock.calls[0]![0];
    expect(arg.scope).toBe('org');
    expect(arg.tenantId).toBe('org-1');
    expect(arg.question).toBe('что решили?');
  });

  it('маппит usedBlockIds → sourceMessageIds через RawEvent.sourceExternalId msg:..', async () => {
    const { service } = build({
      member: { id: 'm-1' },
      ephemeral: { text: 'A', citations: [], usedBlockIds: ['block-1', 'block-2'] },
      evidenceRows: [
        { rawEvent: { sourceExternalId: 'msg:msg-42' } },
        { rawEvent: { sourceExternalId: 'msg:msg-42' } },
        { rawEvent: { sourceExternalId: 'meeting:abc' } },
        { rawEvent: { sourceExternalId: 'msg:msg-77' } },
      ],
    });

    const res = await service.ask({
      tenantId: 'org-1',
      userId: 'u-1',
      conversationId: 'conv-1',
      question: 'q',
    });

    expect(res.answer).toBe('A');
    expect(res.sourceMessageIds.sort()).toEqual(['msg-42', 'msg-77']);
  });

  it('нет usedBlockIds → пустой sourceMessageIds (best-effort)', async () => {
    const { service, evidenceFindMany } = build({
      member: { id: 'm-1' },
      ephemeral: { text: 'A', citations: [], usedBlockIds: [] },
    });

    const res = await service.ask({
      tenantId: 'org-1',
      userId: 'u-1',
      conversationId: 'conv-1',
      question: 'q',
    });

    expect(res.sourceMessageIds).toEqual([]);
    expect(evidenceFindMany).not.toHaveBeenCalled();
  });

  it('не член → 403, chat-v2 не вызван', async () => {
    const { service, askEphemeral } = build({ member: null });

    await expect(
      service.ask({ tenantId: 'org-1', userId: 'u-1', conversationId: 'conv-1', question: 'q' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(askEphemeral).not.toHaveBeenCalled();
  });

  it('CHAT_V2_ENABLED=false → 503', async () => {
    const { service, askEphemeral } = build({ chatV2Enabled: false });

    await expect(
      service.ask({ tenantId: 'org-1', userId: 'u-1', conversationId: 'conv-1', question: 'q' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(askEphemeral).not.toHaveBeenCalled();
  });
});
