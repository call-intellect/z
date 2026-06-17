import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { CommentsThanksService } from './comments-thanks.service';
import type { RecognitionService } from './recognition.service';

function mkSvc(opts?: {
  initial?: string[];
  authorId?: string;
  tenantOfComment?: string;
  deleted?: boolean;
}): {
  svc: CommentsThanksService;
  prisma: {
    issueComment: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  recognition: { enqueueFormulate: ReturnType<typeof vi.fn> };
} {
  const initial = opts?.initial ?? [];
  let current = [...initial];
  const comment = {
    id: 'comment-1',
    authorId: opts?.authorId ?? 'user-author',
    deletedAt: opts?.deleted ? new Date() : null,
    thanksUserIds: current,
    issue: { tenantId: opts?.tenantOfComment ?? 'org-1' },
  };
  const txComment = {
    thanksUserIds: current,
    authorId: comment.authorId,
  };
  const prisma = {
    issueComment: {
      findUnique: vi.fn().mockImplementation(({ select }) => {
        if (select) return Promise.resolve(txComment);
        return Promise.resolve(comment);
      }),
      update: vi.fn().mockImplementation(({ data }) => {
        current = data.thanksUserIds as string[];
        txComment.thanksUserIds = current;
        comment.thanksUserIds = current;
        return Promise.resolve({});
      }),
    },
    $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => {
      return cb(prisma);
    }),
  };
  const recognition = {
    enqueueFormulate: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
  };
  const svc = new CommentsThanksService(
    prisma as unknown as PrismaService,
    recognition as unknown as RecognitionService,
  );
  return { svc, prisma, recognition };
}

describe('CommentsThanksService.toggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('добавляет userId в thanksUserIds и enqueue Recognition при первом thanks', async () => {
    const { svc, recognition } = mkSvc({ initial: [] });
    const res = await svc.toggle('comment-1', 'org-1', 'user-thanker');
    expect(res).toEqual({ thanksCount: 1, thankedByMe: true });
    expect(recognition.enqueueFormulate).toHaveBeenCalledTimes(1);
    const args = recognition.enqueueFormulate.mock.calls[0]?.[0] as {
      type: string;
      toUserId: string;
      fromUserId: string;
    };
    expect(args.type).toBe('thanks_comment');
    expect(args.toUserId).toBe('user-author');
    expect(args.fromUserId).toBe('user-thanker');
  });

  it('идемпотентно: повторный toggle убирает userId, второй раз добавляет', async () => {
    const { svc, recognition } = mkSvc({ initial: ['user-thanker'] });
    const off = await svc.toggle('comment-1', 'org-1', 'user-thanker');
    expect(off).toEqual({ thanksCount: 0, thankedByMe: false });
    expect(recognition.enqueueFormulate).not.toHaveBeenCalled();
  });

  it('self-thanks: не enqueue Recognition (но toggle применяется)', async () => {
    const { svc, recognition } = mkSvc({
      initial: [],
      authorId: 'user-self',
    });
    const res = await svc.toggle('comment-1', 'org-1', 'user-self');
    expect(res.thanksCount).toBe(1);
    expect(recognition.enqueueFormulate).not.toHaveBeenCalled();
  });

  it('cross-tenant: 404', async () => {
    const { svc } = mkSvc({ initial: [], tenantOfComment: 'org-OTHER' });
    await expect(svc.toggle('comment-1', 'org-1', 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('удалённый комментарий: 404', async () => {
    const { svc } = mkSvc({ initial: [], deleted: true });
    await expect(svc.toggle('comment-1', 'org-1', 'user-1')).rejects.toThrow(NotFoundException);
  });
});

describe('CommentsThanksService.readState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('возвращает thanksCount и thankedByMe', async () => {
    const { svc } = mkSvc({ initial: ['user-A', 'user-B'] });
    const r = await svc.readState('comment-1', 'org-1', 'user-A');
    expect(r).toEqual({ thanksCount: 2, thankedByMe: true });
    const r2 = await svc.readState('comment-1', 'org-1', 'user-C');
    expect(r2).toEqual({ thanksCount: 2, thankedByMe: false });
  });
});
