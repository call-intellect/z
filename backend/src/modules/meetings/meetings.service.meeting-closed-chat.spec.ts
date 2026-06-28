import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';
import type { MeetingsBalanceService } from '../meetings-balance/meetings-balance.service';
import type { MessageService } from '../messaging/services/message.service';
import type { WorkChatService } from '../messaging/services/work-chat.service';
import type { UsersService } from '../users/users.service';

import type { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

function makeService(args: {
  fromStatus?: string;
  toStatus?: string;
  issues?: Array<{ id: string }>;
  recordingUrl?: string | null;
  summaryFast?: string | null;
}) {
  const meetingFindUniqueTx = vi.fn().mockResolvedValue({
    id: 'm-1',
    status: args.fromStatus ?? 'ai_processing',
  });
  const meetingUpdate = vi.fn().mockResolvedValue({ id: 'm-1', status: args.toStatus ?? 'ai_ready' });
  const meetingEventCreate = vi.fn().mockResolvedValue({});

  const meetingDetailFindUnique = vi.fn().mockResolvedValue({
    id: 'm-1',
    title: 'Синк по проекту',
    ownerId: 'owner-1',
    recording: { mainVideoUrl: args.recordingUrl ?? 'https://s3/rec.mp4' },
    aiResult: { summaryFast: args.summaryFast ?? 'Кратко: договорились о сроках.', summary: null },
  });
  const issueFindMany = vi.fn().mockResolvedValue(args.issues ?? [{ id: 'issue-1' }]);
  const conversationFindUnique = vi.fn().mockResolvedValue({ tenantId: 'org-1' });

  const txClient = {
    meeting: { findUnique: meetingFindUniqueTx, update: meetingUpdate },
    meetingEvent: { create: meetingEventCreate },
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    meeting: { findUnique: meetingDetailFindUnique },
    issue: { findMany: issueFindMany },
    conversation: { findUnique: conversationFindUnique },
  } as unknown as PrismaService;

  const ensureWorkChat = vi.fn().mockResolvedValue({ conversationId: 'conv-1' });
  const workChat = { ensureWorkChat } as unknown as WorkChatService;

  const appendSystemMessage = vi
    .fn()
    .mockResolvedValue({ messageId: 'sys-1', seq: '1', deduped: false });
  const messages = { appendSystemMessage } as unknown as MessageService;

  const svc = new MeetingsService(
    prisma,
    {} as unknown as MeetingsRepository,
    {} as unknown as UsersService,
    {} as unknown as JwtService,
    {} as unknown as TypedConfigService,
    {} as unknown as BusinessMetricsService,
    {} as unknown as MeetingsBalanceService,
    {} as never,
    {} as never,
    {} as never,
    workChat,
    messages,
  );

  return { svc, ensureWorkChat, appendSystemMessage, issueFindMany };
}

describe('MeetingsService.transitionStatus → системное сообщение о закрытии встречи', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ai_ready + связанная задача → appendSystemMessage с meeting-closed clientMessageId', async () => {
    const { svc, ensureWorkChat, appendSystemMessage } = makeService({
      fromStatus: 'ai_processing',
      toStatus: 'ai_ready',
    });

    await svc.transitionStatus('m-1', 'ai_ready');

    expect(ensureWorkChat).toHaveBeenCalledWith('issue-1');
    expect(appendSystemMessage).toHaveBeenCalledTimes(1);
    const arg = appendSystemMessage.mock.calls[0]![0];
    expect(arg.conversationId).toBe('conv-1');
    expect(arg.tenantId).toBe('org-1');
    expect(arg.authorUserId).toBe('owner-1');
    expect(arg.clientMessageId).toBe('meeting-closed:m-1');
    expect(arg.content).toContain('Встреча завершена');
    expect(arg.content).toContain('Запись:');
    expect(arg.content).toContain('Резюме:');
  });

  it('идемпотентность: один clientMessageId meeting-closed:<id> на встречу', async () => {
    const { svc, appendSystemMessage } = makeService({ toStatus: 'ai_ready' });

    await svc.transitionStatus('m-1', 'ai_ready');
    await svc.transitionStatus('m-1', 'ai_ready');

    expect(appendSystemMessage).toHaveBeenCalledTimes(2);
    expect(appendSystemMessage.mock.calls[0]![0].clientMessageId).toBe('meeting-closed:m-1');
    expect(appendSystemMessage.mock.calls[1]![0].clientMessageId).toBe('meeting-closed:m-1');
  });

  it('нет связанных задач → no-op (appendSystemMessage НЕ вызван)', async () => {
    const { svc, appendSystemMessage, ensureWorkChat } = makeService({
      toStatus: 'ai_ready',
      issues: [],
    });

    await svc.transitionStatus('m-1', 'ai_ready');

    expect(ensureWorkChat).not.toHaveBeenCalled();
    expect(appendSystemMessage).not.toHaveBeenCalled();
  });
});
