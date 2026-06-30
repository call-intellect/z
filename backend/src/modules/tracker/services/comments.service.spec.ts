import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { MessageService } from '../../messaging/services/message.service';
import type { WorkChatService } from '../../messaging/services/work-chat.service';
import type { CreateCommentDto } from '../dto/comments/create-comment.dto';
import type { UpdateCommentDto } from '../dto/comments/update-comment.dto';

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
  appendMessage: ReturnType<typeof vi.fn>;
  issueMentionCreated: Array<{ mentionedUserId: string; commentId: string | null }>;
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
    conversationId: 'conv-1',
  };

  const issueMentionCreated: Array<{ mentionedUserId: string; commentId: string | null }> = [];

  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        issueMention: {
          createMany: vi.fn(
            async (args: { data: Array<{ mentionedUserId: string; commentId: string | null }> }) => {
              for (const d of args.data) {
                issueMentionCreated.push({
                  mentionedUserId: d.mentionedUserId,
                  commentId: d.commentId,
                });
              }
              return { count: args.data.length };
            },
          ),
        },
      };
      return cb(tx);
    }),
    user: {
      findMany: vi.fn(async () => opts.users),
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
  const appendMessage = vi.fn(async () => ({
    messageId: 'msg-1',
    conversationId: 'conv-1',
    seq: '1',
  }));
  const workChat = { appendMessage } as unknown as WorkChatService;
  const messages = {
    editMessage: vi.fn(async () => undefined),
    softDeleteMessage: vi.fn(async () => undefined),
  } as unknown as MessageService;
  const crypto = {
    encrypt: vi.fn((s: string) => `gcm:v1:${s}`),
    decrypt: vi.fn((s: string) => s.replace(/^gcm:v1:/, '')),
  } as unknown as CryptoService;
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
    workChat,
    messages,
    crypto,
    conversational,
  );
  return { svc, sendNotification, emitMentionCreated, appendMessage, issueMentionCreated };
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

describe('CommentsService: redirect storage → Message', () => {
  const users: UserRow[] = [{ id: 'author-id', email: 'author@example.com' }];

  it('create делегирует в workChat.appendMessage, id = messageId', async () => {
    const { svc, appendMessage } = makeService({ users });
    const res = await svc.create('i1', baseDto('обычный коммент'), 'tenant-1', 'author-id');
    expect(appendMessage).toHaveBeenCalledTimes(1);
    const call = appendMessage.mock.calls[0]![0] as { issueId: string; authorUserId: string };
    expect(call.issueId).toBe('i1');
    expect(call.authorUserId).toBe('author-id');
    expect(res.id).toBe('msg-1');
    expect(res.content).toBe('обычный коммент');
  });

  it('IssueMention пишется с commentId=null (mention на задачу)', async () => {
    const usersWithAnna: UserRow[] = [
      { id: 'user-anna', email: 'anna@example.com' },
      { id: 'author-id', email: 'author@example.com' },
    ];
    const { svc, issueMentionCreated } = makeService({ users: usersWithAnna });
    await svc.create('i1', baseDto('@anna смотри'), 'tenant-1', 'author-id');
    expect(issueMentionCreated.length).toBeGreaterThan(0);
    for (const m of issueMentionCreated) {
      expect(m.commentId).toBeNull();
    }
  });
});

describe('CommentsService.findByIssue: мерж Message + legacy IssueComment', () => {
  function makeFindService(args: {
    conversationId: string | null;
    legacy: Array<{
      id: string;
      createdAt: Date;
      content: string;
      mentions: Array<{ mentionedUserId: string }>;
    }>;
    messages: Array<{
      id: string;
      seq: bigint;
      createdAt: Date;
      content: string;
      authorUserId: string;
    }>;
  }) {
    const issue = {
      id: 'i1',
      identifier: 'PRJ-7',
      title: 'T',
      tenantId: 'tenant-1',
      conversationId: args.conversationId,
    };
    const legacyFindMany = vi.fn(async (_q: { where: { messageId: string | null } }) =>
      args.legacy.map((l) => ({
        id: l.id,
        issueId: 'i1',
        authorId: 'a',
        parentCommentId: null,
        content: l.content,
        contentHtml: null,
        contentStripped: null,
        access: 'internal',
        voiceUrl: null,
        voiceDuration: null,
        voiceTranscript: null,
        mentions: l.mentions,
        createdAt: l.createdAt,
        editedAt: null,
        deletedAt: null,
      })),
    );
    const messageFindMany = vi.fn(async () =>
      args.messages.map((m) => ({
        id: m.id,
        tenantId: 'tenant-1',
        conversationId: args.conversationId,
        seq: m.seq,
        authorUserId: m.authorUserId,
        authorType: 'human',
        access: 'normal',
        content: m.content,
        contentHtml: null,
        contentStripped: null,
        parentMessageId: null,
        clientMessageId: `cmid-${m.id}`,
        voiceUrl: null,
        voiceDuration: null,
        voiceTranscript: null,
        attachments: null,
        mentions: [],
        reactions: null,
        thanksUserIds: [],
        draftState: null,
        cloneConfidence: null,
        groundednessScore: null,
        editedAt: null,
        deletedAt: null,
        createdAt: m.createdAt,
      })),
    );
    const prisma = {
      issueComment: { findMany: legacyFindMany },
      message: { findMany: messageFindMany },
    } as unknown as PrismaService;
    const issues = { requireIssue: vi.fn(async () => issue) } as unknown as IssuesService;
    const crypto = {
      decrypt: vi.fn((s: string) => s.replace(/^gcm:v1:/, '')),
    } as unknown as CryptoService;
    const svc = new CommentsService(
      prisma,
      { record: vi.fn() } as unknown as ActivityRecorderService,
      issues,
      { publishCommentCreated: vi.fn() } as unknown as TrackerEventsService,
      { dispatch: vi.fn() } as unknown as WebhookDispatcher,
      { emitCommentCreated: vi.fn(), emitMentionCreated: vi.fn() } as unknown as TrackerEmitterService,
      { appendMessage: vi.fn() } as unknown as WorkChatService,
      {
        editMessage: vi.fn(),
        softDeleteMessage: vi.fn(),
      } as unknown as MessageService,
      crypto,
      null,
    );
    return { svc, legacyFindMany, messageFindMany };
  }

  it('мержит legacy + Message по createdAt, расшифровывает Message.content', async () => {
    const { svc, legacyFindMany } = makeFindService({
      conversationId: 'conv-1',
      legacy: [
        {
          id: 'legacy-1',
          createdAt: new Date('2026-06-28T10:00:00Z'),
          content: 'старый',
          mentions: [],
        },
      ],
      messages: [
        {
          id: 'msg-1',
          seq: 1n,
          createdAt: new Date('2026-06-28T11:00:00Z'),
          content: 'gcm:v1:новый',
          authorUserId: 'u1',
        },
      ],
    });

    const res = await svc.findByIssue('i1', 'tenant-1');
    expect(res.map((r) => r.id)).toEqual(['legacy-1', 'msg-1']);
    expect(res[1]!.content).toBe('новый');
    const where = legacyFindMany.mock.calls[0]![0].where;
    expect(where.messageId).toBeNull();
  });

  it('без conversationId — только legacy, message.findMany НЕ вызван', async () => {
    const { svc, messageFindMany } = makeFindService({
      conversationId: null,
      legacy: [
        {
          id: 'legacy-1',
          createdAt: new Date('2026-06-28T10:00:00Z'),
          content: 'старый',
          mentions: [],
        },
      ],
      messages: [],
    });

    const res = await svc.findByIssue('i1', 'tenant-1');
    expect(res.map((r) => r.id)).toEqual(['legacy-1']);
    expect(messageFindMany).not.toHaveBeenCalled();
  });
});

describe('CommentsService: update/softDelete redirect (message-backed vs legacy)', () => {
  function makeMessageRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'msg-1',
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      seq: 1n,
      authorUserId: 'author-1',
      authorType: 'human',
      access: 'normal',
      content: 'gcm:v1:текст',
      contentHtml: null,
      contentStripped: null,
      parentMessageId: null,
      clientMessageId: 'ic:c1',
      voiceUrl: null,
      voiceDuration: null,
      voiceTranscript: null,
      attachments: null,
      mentions: [],
      reactions: null,
      thanksUserIds: [],
      draftState: null,
      cloneConfidence: null,
      groundednessScore: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date('2026-06-28T00:00:00Z'),
      ...overrides,
    };
  }

  function makeService(args: {
    messageRow: Record<string, unknown> | null;
    legacyComment?: Record<string, unknown> | null;
  }) {
    const messageFindUnique = vi.fn(async () => args.messageRow);
    const messageUpdate = vi.fn(async (_args: { where: unknown; data: { deletedAt?: Date } }) => ({}));
    const issueCommentFindUnique = vi.fn(async () => args.legacyComment ?? null);
    const issueCommentUpdate = vi.fn(async (_args: unknown) => ({}));
    const getLinkedIssue = vi.fn(async () => ({ id: 'iss-1', identifier: 'T-1', title: 'Task' }));
    const editMessage = vi.fn(async () => undefined);
    const softDeleteMessage = vi.fn(async () => undefined);

    const prisma = {
      message: { findUnique: messageFindUnique, update: messageUpdate },
      issueComment: {
        findUnique: issueCommentFindUnique,
        update: issueCommentUpdate,
        findMany: vi.fn(async () => []),
      },
    } as unknown as PrismaService;
    const crypto = {
      decrypt: vi.fn((s: string) => s.replace(/^gcm:v1:/, '')),
    } as unknown as CryptoService;
    const messages = { editMessage, softDeleteMessage } as unknown as MessageService;
    const workChat = { getLinkedIssue, appendMessage: vi.fn() } as unknown as WorkChatService;

    const svc = new CommentsService(
      prisma,
      { record: vi.fn() } as unknown as ActivityRecorderService,
      { requireIssue: vi.fn() } as unknown as IssuesService,
      {
        publishCommentUpdated: vi.fn(),
        publishCommentDeleted: vi.fn(),
      } as unknown as TrackerEventsService,
      { dispatch: vi.fn(async () => {}) } as unknown as WebhookDispatcher,
      { emitCommentCreated: vi.fn(), emitMentionCreated: vi.fn() } as unknown as TrackerEmitterService,
      workChat,
      messages,
      crypto,
      null,
    );
    return {
      svc,
      editMessage,
      softDeleteMessage,
      messageUpdate,
      issueCommentUpdate,
    };
  }

  const updateDto = {
    content: 'обновлено',
    contentHtml: null,
    contentStripped: 'обновлено',
  } as unknown as UpdateCommentDto;

  it('update: message-backed → MessageService.editMessage, issueComment.update НЕ вызван', async () => {
    const { svc, editMessage, issueCommentUpdate } = makeService({
      messageRow: makeMessageRow(),
    });
    await svc.update('msg-1', updateDto, 'tenant-1', 'author-1');
    expect(editMessage).toHaveBeenCalledWith({
      messageId: 'msg-1',
      userId: 'author-1',
      content: 'обновлено',
      contentHtml: null,
    });
    expect(issueCommentUpdate).not.toHaveBeenCalled();
  });

  it('update: legacy (нет Message) → issueComment.update, editMessage НЕ вызван', async () => {
    const { svc, editMessage, issueCommentUpdate } = makeService({
      messageRow: null,
      legacyComment: {
        id: 'c1',
        issueId: 'iss-1',
        authorId: 'author-1',
        parentCommentId: null,
        content: 'старый',
        contentHtml: null,
        contentStripped: 'старый',
        access: 'internal',
        voiceUrl: null,
        voiceDuration: null,
        voiceTranscript: null,
        createdAt: new Date('2026-06-28T00:00:00Z'),
        editedAt: null,
        deletedAt: null,
        mentions: [],
        issue: { tenantId: 'tenant-1' },
      },
    });
    await svc.update('c1', updateDto, 'tenant-1', 'author-1');
    expect(issueCommentUpdate).toHaveBeenCalled();
    expect(editMessage).not.toHaveBeenCalled();
  });

  it('softDelete: message-backed → message.update (deletedAt), softDeleteMessage не нужен (admin/author)', async () => {
    const { svc, messageUpdate, issueCommentUpdate } = makeService({
      messageRow: makeMessageRow(),
    });
    await svc.softDelete('msg-1', 'tenant-1', 'author-1', false);
    expect(messageUpdate.mock.calls[0]![0].data.deletedAt).toBeInstanceOf(Date);
    expect(issueCommentUpdate).not.toHaveBeenCalled();
  });

  it('softDelete: message-backed чужим не-админом → Forbidden, message.update НЕ вызван', async () => {
    const { svc, messageUpdate } = makeService({
      messageRow: makeMessageRow({ authorUserId: 'other' }),
    });
    await expect(svc.softDelete('msg-1', 'tenant-1', 'author-1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(messageUpdate).not.toHaveBeenCalled();
  });

  it('softDelete: legacy → issueComment.update, message.update НЕ вызван', async () => {
    const { svc, messageUpdate, issueCommentUpdate } = makeService({
      messageRow: null,
      legacyComment: {
        id: 'c1',
        issueId: 'iss-1',
        authorId: 'author-1',
        deletedAt: null,
        issue: { tenantId: 'tenant-1' },
      },
    });
    await svc.softDelete('c1', 'tenant-1', 'author-1', false);
    expect(issueCommentUpdate).toHaveBeenCalled();
    expect(messageUpdate).not.toHaveBeenCalled();
  });
});
