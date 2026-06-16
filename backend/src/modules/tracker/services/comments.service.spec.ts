import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { CreateCommentDto } from '../dto/comments/create-comment.dto';

import type { ActivityRecorderService } from './activity-recorder.service';
import { CommentsService } from './comments.service';
import type { IssuesService } from './issues.service';
import type { TrackerEmitterService } from './tracker-emitter.service';
import type { TrackerEventsService } from './tracker-events.service';
import type { WebhookDispatcher } from './webhook-dispatcher.service';

interface UserRow {
  id: string;
  email: string | null;
}

function makeService(opts: { users: UserRow[] }): {
  svc: CommentsService;
  sendNotification: ReturnType<typeof vi.fn>;
  emitMentionCreated: ReturnType<typeof vi.fn>;
} {
  const issue = {
    id: 'i1',
    identifier: 'PRJ-7',
    title: 'Сделать важное',
    tenantId: 'tenant-1',
    projectId: 'p1',
    description: null,
    stateId: null,
    dueDate: null,
  };

  const createdComment = {
    id: 'c1',
    issueId: 'i1',
    authorId: 'author-id',
    parentCommentId: null,
    content: '@anna @user-3 привет',
    contentHtml: null,
    contentStripped: '@anna @user-3 привет',
    access: 'internal',
    voiceUrl: null,
    voiceDuration: null,
    voiceTranscript: null,
    createdAt: new Date('2026-05-24T10:00:00Z'),
    editedAt: null,
    deletedAt: null,
  };

  const issueMentionCreated: Array<{ mentionedUserId: string }> = [];

  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        issueComment: {
          create: vi.fn(async () => createdComment),
        },
        issueMention: {
          createMany: vi.fn(async (args: { data: Array<{ mentionedUserId: string }> }) => {
            for (const d of args.data) {
              issueMentionCreated.push({ mentionedUserId: d.mentionedUserId });
            }
            return { count: args.data.length };
          }),
        },
      };
      return cb(tx);
    }),
    user: {
      findMany: vi.fn(async () => opts.users),
    },
    issueComment: {
      findUnique: vi.fn(async () => ({
        ...createdComment,
        mentions: issueMentionCreated,
      })),
    },
  } as unknown as PrismaService;

  const activity = { record: vi.fn(async () => {}) } as unknown as ActivityRecorderService;
  const issues = {
    requireIssue: vi.fn(async () => issue),
  } as unknown as IssuesService;
  const events = {
    publishCommentCreated: vi.fn(),
  } as unknown as TrackerEventsService;
  const webhooks = { dispatch: vi.fn(async () => {}) } as unknown as WebhookDispatcher;
  const emitMentionCreated = vi.fn();
  const emitter = {
    emitCommentCreated: vi.fn(),
    emitMentionCreated,
  } as unknown as TrackerEmitterService;
  const sendNotification = vi.fn(async () => ({ id: 'n1' }));
  const conversational = {
    sendNotification,
  } as unknown as ConversationalService;

  const svc = new CommentsService(
    prisma,
    activity,
    issues,
    events,
    webhooks,
    emitter,
    conversational,
  );
  return { svc, sendNotification, emitMentionCreated };
}

const baseDto = (content: string): CreateCommentDto => ({
  content,
  contentHtml: null,
  contentStripped: content,
  parentCommentId: null,
  access: 'internal',
  voiceUrl: null,
  voiceDuration: null,
  voiceTranscript: null,
});

describe('CommentsService: mentions + notifications', () => {
  let users: UserRow[];

  beforeEach(() => {
    users = [
      { id: 'user-anna', email: 'anna@example.com' },
      { id: 'user-3', email: 'borya@example.com' },
      { id: 'author-id', email: 'author@example.com' },
    ];
  });

  it('1: @anna резолвится в user-anna по email-local-part', async () => {
    const { svc, emitMentionCreated } = makeService({ users });
    const res = await svc.create('i1', baseDto('Привет @anna!'), 'tenant-1', 'author-id');
    expect(res.mentionedUserIds).toContain('user-anna');
    expect(emitMentionCreated).toHaveBeenCalled();
  });

  it('2: @user-3 резолвится по userId', async () => {
    const { svc } = makeService({ users });
    const res = await svc.create('i1', baseDto('Привет @user-3'), 'tenant-1', 'author-id');
    expect(res.mentionedUserIds).toContain('user-3');
  });

  it('3: дубликаты @anna @anna @anna дают один Mention', async () => {
    const { svc } = makeService({ users });
    const res = await svc.create('i1', baseDto('@anna @anna @anna'), 'tenant-1', 'author-id');
    const annaCount = res.mentionedUserIds.filter((id) => id === 'user-anna').length;
    expect(annaCount).toBe(1);
  });

  it('4: неизвестный токен игнорируется', async () => {
    const { svc } = makeService({ users });
    const res = await svc.create('i1', baseDto('@nosuchuser hello'), 'tenant-1', 'author-id');
    expect(res.mentionedUserIds).toHaveLength(0);
  });

  it('5: sendNotification вызывается для упомянутых, кроме автора', async () => {
    const { svc, sendNotification } = makeService({ users });
    await svc.create('i1', baseDto('@anna @author посмотри'), 'tenant-1', 'author-id');
    await Promise.resolve();
    await Promise.resolve();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const call = sendNotification.mock.calls[0]![0] as {
      recipientUserId: string;
      eventType: string;
      payload: { issueId: string; commentId: string; byUserId: string };
    };
    expect(call.recipientUserId).toBe('user-anna');
    expect(call.eventType).toBe('issue.mention');
    expect(call.payload.issueId).toBe('i1');
    expect(call.payload.byUserId).toBe('author-id');
  });
});
