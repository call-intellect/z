import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import { CommitmentResponseHandler } from './commitment-response.handler';

/**
 * SBA β-8.2 — CommitmentResponseHandler unit-тесты.
 *
 * Покрываем:
 *   1. Игнор события не-`probe.question`.
 *   2. Игнор reason ≠ 'commitment.followup'.
 *   3. Игнор уже терминальных блоков (fulfilled/missed/cancelled/superseded).
 *   4. При status='fulfilled' создаёт commitment_status блок + resolves
 *      ребро + обновляет исходный.
 *   5. При status='missed' + blockerText создаёт дополнительный blocker блок.
 *   6. LLM упал → инкремент метрики, без апдейтов.
 */
describe('CommitmentResponseHandler', () => {
  function build(overrides: {
    notif?: { payload: Record<string, unknown> } | null;
    original?: {
      id: string;
      tenantId: string;
      signalType: string;
      commitmentStatus: string | null;
      dataClass: string;
      criticalQuestion: string;
      trustedAnswer: string;
    } | null;
    llmResponse?: string;
    llmThrows?: boolean;
  }) {
    const txCalls = {
      ideaBlockCreates: 0,
      ideaBlockLinkCreates: 0,
      ideaBlockUpdates: 0,
    };
    const txMock = {
      ideaBlock: {
        create: vi.fn().mockImplementation(({ data }) => {
          txCalls.ideaBlockCreates++;
          return Promise.resolve({ id: `created-${txCalls.ideaBlockCreates}`, ...data });
        }),
        update: vi.fn().mockImplementation(() => {
          txCalls.ideaBlockUpdates++;
          return Promise.resolve({});
        }),
      },
      ideaBlockLink: {
        create: vi.fn().mockImplementation(() => {
          txCalls.ideaBlockLinkCreates++;
          return Promise.resolve({});
        }),
      },
    };
    const prisma = {
      notification: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            overrides.notif === undefined
              ? {
                  payload: {
                    reason: 'commitment.followup',
                    contextBlockId: 'orig-1',
                  },
                  recipientUserId: 'u1',
                  tenantId: 't1',
                }
              : overrides.notif,
          ),
      },
      ideaBlock: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.original === undefined
            ? {
                id: 'orig-1',
                tenantId: 't1',
                signalType: 'commitment',
                commitmentStatus: 'asked',
                dataClass: 'internal',
                criticalQuestion: 'Сделать X',
                trustedAnswer: 'Я возьму X',
              }
            : overrides.original,
        ),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (cb: (tx: typeof txMock) => Promise<unknown>) => {
          return cb(txMock);
        }),
    };
    const llm = {
      call: overrides.llmThrows
        ? vi.fn().mockRejectedValue(new Error('LLM down'))
        : vi.fn().mockResolvedValue({
            text:
              overrides.llmResponse ??
              JSON.stringify({
                status: 'fulfilled',
                rationale: 'Готово',
                blockerText: null,
              }),
          }),
    };
    const metrics = {
      incCommitmentsFulfilled: vi.fn(),
      incCommitmentsMissed: vi.fn(),
      incCommitmentsExtractFailed: vi.fn(),
    };
    const handler = new CommitmentResponseHandler(
      prisma as never,
      llm as never,
      metrics as never,
    );
    return { handler, prisma, llm, metrics, txCalls, txMock };
  }

  it('игнор события не-probe.question', async () => {
    const { handler, prisma } = build({});
    await handler.handle({
      tenantId: 't1',
      notificationId: 'n1',
      recipientUserId: 'u1',
      eventType: 'checkin.prompt',
      payload: { text: 'foo' },
    });
    expect(prisma.notification.findUnique).not.toHaveBeenCalled();
  });

  it('игнор reason ≠ commitment.followup', async () => {
    const { handler, prisma } = build({
      notif: {
        payload: { reason: 'other.thing', contextBlockId: 'orig-1' },
      },
    });
    await handler.handle({
      tenantId: 't1',
      notificationId: 'n1',
      recipientUserId: 'u1',
      eventType: 'probe.question',
      payload: { text: 'сделано' },
    });
    expect(prisma.ideaBlock.findUnique).not.toHaveBeenCalled();
  });

  it('игнор уже терминального блока (fulfilled)', async () => {
    const { handler, llm } = build({
      original: {
        id: 'orig-1',
        tenantId: 't1',
        signalType: 'commitment',
        commitmentStatus: 'fulfilled',
        dataClass: 'internal',
        criticalQuestion: 'X',
        trustedAnswer: 'Y',
      },
    });
    await handler.handle({
      tenantId: 't1',
      notificationId: 'n1',
      recipientUserId: 'u1',
      eventType: 'probe.question',
      payload: { text: 'сделано' },
    });
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('status=fulfilled → создаётся commitment_status + resolves + обновляется исходный', async () => {
    const { handler, txCalls, metrics } = build({
      llmResponse: JSON.stringify({
        status: 'fulfilled',
        rationale: 'Готово',
        blockerText: null,
      }),
    });
    await handler.handle({
      tenantId: 't1',
      notificationId: 'n1',
      recipientUserId: 'u1',
      eventType: 'probe.question',
      payload: { text: 'сделано' },
    });
    // 1 create (commitment_status), 1 link, 1 update.
    expect(txCalls.ideaBlockCreates).toBe(1);
    expect(txCalls.ideaBlockLinkCreates).toBe(1);
    expect(txCalls.ideaBlockUpdates).toBe(1);
    expect(metrics.incCommitmentsFulfilled).toHaveBeenCalledOnce();
  });

  it('status=missed + blockerText → дополнительный blocker блок', async () => {
    const { handler, txCalls, metrics } = build({
      llmResponse: JSON.stringify({
        status: 'missed',
        rationale: 'Заблокирован',
        blockerText: 'Жду ответа от подрядчика',
      }),
    });
    await handler.handle({
      tenantId: 't1',
      notificationId: 'n1',
      recipientUserId: 'u1',
      eventType: 'probe.question',
      payload: { text: 'не сделал, жду подрядчика' },
    });
    // 2 create (commitment_status + blocker), 1 link, 1 update.
    expect(txCalls.ideaBlockCreates).toBe(2);
    expect(txCalls.ideaBlockLinkCreates).toBe(1);
    expect(txCalls.ideaBlockUpdates).toBe(1);
    expect(metrics.incCommitmentsMissed).toHaveBeenCalledOnce();
  });

  it('LLM упал → инкремент метрики extract_failed, без апдейтов', async () => {
    const { handler, metrics, prisma } = build({ llmThrows: true });
    await handler.handle({
      tenantId: 't1',
      notificationId: 'n1',
      recipientUserId: 'u1',
      eventType: 'probe.question',
      payload: { text: 'сделано' },
    });
    expect(metrics.incCommitmentsExtractFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'llm_failed' }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('idempotent: P2002 на ideaBlockLink не валит обработку', async () => {
    const { handler, txCalls, txMock } = build({});
    txMock.ideaBlockLink.create = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await handler.handle({
      tenantId: 't1',
      notificationId: 'n1',
      recipientUserId: 'u1',
      eventType: 'probe.question',
      payload: { text: 'сделано' },
    });
    // Несмотря на P2002 на линке — статус обновлён.
    expect(txCalls.ideaBlockCreates).toBe(1);
    expect(txCalls.ideaBlockUpdates).toBe(1);
  });
});
