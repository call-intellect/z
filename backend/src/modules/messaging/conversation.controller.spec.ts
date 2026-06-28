import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import type { RbacService } from '../rbac/rbac.service';

import { ConversationController } from './conversation.controller';
import { CreateConversationSchema } from './dto/conversation.dto';
import type { ConversationService } from './services/conversation.service';
import type { MessageService } from './services/message.service';
import type { ReadCursorService } from './services/read-cursor.service';
import type { WorkChatService } from './services/work-chat.service';

const TENANT = 'org_1';
const USER: CurrentUserPayload = { id: 'user_1', email: 'u@example.com', role: 'user' };

function makeController(overrides: {
  conversations?: Partial<ConversationService>;
  messages?: Partial<MessageService>;
  readCursors?: Partial<ReadCursorService>;
  rbac?: Partial<RbacService>;
  workChat?: Partial<WorkChatService>;
}) {
  const conversations = {
    createConversation: vi.fn(),
    addMember: vi.fn(),
    assertMember: vi.fn(),
    getMemberRole: vi.fn(),
    isMandatory: vi.fn(),
    removeMember: vi.fn(),
    ensureCompanyChannel: vi.fn(),
    ...overrides.conversations,
  } as unknown as ConversationService;
  const messages = {
    sendMessage: vi.fn(),
    getMessages: vi.fn(),
    toggleReaction: vi.fn(),
    ...overrides.messages,
  } as unknown as MessageService;
  const readCursors = {
    markRead: vi.fn(),
    ...overrides.readCursors,
  } as unknown as ReadCursorService;
  const rbac = {
    canWrite: vi.fn(async () => true),
    ...overrides.rbac,
  } as unknown as RbacService;
  const workChat = {
    ensureWorkChat: vi.fn(),
    getLinkedIssue: vi.fn(),
    ...overrides.workChat,
  } as unknown as WorkChatService;
  return {
    controller: new ConversationController(conversations, messages, readCursors, rbac, workChat),
    conversations,
    messages,
    readCursors,
    rbac,
    workChat,
  };
}

describe('ConversationController POST /conversations', () => {
  it('создаёт group, делегирует в createConversation, возвращает conversationId', async () => {
    const { controller, conversations } = makeController({
      conversations: {
        createConversation: vi.fn(async () => ({ id: 'conv_1' }) as never),
      },
    });
    const res = await controller.create(
      { kind: 'group', memberUserIds: ['u2'] },
      USER,
      TENANT,
    );
    expect(res.conversationId).toBe('conv_1');
    expect(conversations.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, kind: 'group', createdByUserId: USER.id }),
    );
  });

  it.each(['dm', 'channel'] as const)('принимает kind=%s через Zod', (kind) => {
    const pipe = new ZodValidationPipe(CreateConversationSchema);
    expect(() => pipe.transform({ kind, memberUserIds: [] })).not.toThrow();
  });

  it.each(['ticket', 'external', 'work_chat'] as const)(
    'kind=%s → 400 (Zod отвергает чужую фазу)',
    (kind) => {
      const pipe = new ZodValidationPipe(CreateConversationSchema);
      expect(() => pipe.transform({ kind, memberUserIds: [] })).toThrow(BadRequestException);
    },
  );

  it('нет tenant → 400', async () => {
    const { controller } = makeController({});
    await expect(
      controller.create({ kind: 'dm', memberUserIds: [] }, USER, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ConversationController DELETE /conversations/:id/members/me', () => {
  it('обязательный канал → 409 MANDATORY_CHANNEL_LEAVE_FORBIDDEN, membership не удалён', async () => {
    const { controller, conversations } = makeController({
      conversations: { isMandatory: vi.fn(async () => true) },
    });
    await expect(controller.leave('conv_1', USER, TENANT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(conversations.removeMember).not.toHaveBeenCalled();
  });

  it('обычный разговор → удаляет членство', async () => {
    const { controller, conversations } = makeController({
      conversations: { isMandatory: vi.fn(async () => false) },
    });
    const res = await controller.leave('conv_1', USER, TENANT);
    expect(res.ok).toBe(true);
    expect(conversations.removeMember).toHaveBeenCalledWith('conv_1', USER.id);
  });
});

describe('ConversationController POST /conversations/:id/members', () => {
  it('requester owner → добавляет', async () => {
    const { controller, conversations } = makeController({
      conversations: { getMemberRole: vi.fn(async () => 'owner') },
    });
    const res = await controller.addMember('conv_1', { userId: 'u3' }, USER, TENANT);
    expect(res.ok).toBe(true);
    expect(conversations.addMember).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      userId: 'u3',
    });
  });

  it('requester member → 403', async () => {
    const { controller, conversations } = makeController({
      conversations: { getMemberRole: vi.fn(async () => 'member') },
    });
    await expect(
      controller.addMember('conv_1', { userId: 'u3' }, USER, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conversations.addMember).not.toHaveBeenCalled();
  });
});

describe('ConversationController POST /conversations/:id/messages', () => {
  it('не член → 403 NOT_MEMBER, sendMessage не вызван', async () => {
    const { controller, messages } = makeController({
      conversations: { assertMember: vi.fn(async () => false) },
    });
    await expect(
      controller.sendMessage(
        'conv_1',
        { content: 'hi', clientMessageId: 'c1' },
        USER,
        TENANT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(messages.sendMessage).not.toHaveBeenCalled();
  });

  it('член → 201, sendMessage делегирован с tenantId/authorUserId', async () => {
    const sent = { message: { id: 'm1' }, deduped: false };
    const { controller, messages } = makeController({
      conversations: { assertMember: vi.fn(async () => true) },
      messages: { sendMessage: vi.fn(async () => sent as never) },
    });
    const res = await controller.sendMessage(
      'conv_1',
      { content: 'hi', clientMessageId: 'c1' },
      USER,
      TENANT,
    );
    expect(res).toBe(sent);
    expect(messages.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        conversationId: 'conv_1',
        authorUserId: USER.id,
        content: 'hi',
        clientMessageId: 'c1',
      }),
    );
  });
});

describe('ConversationController GET /conversations/:id/messages', () => {
  it('не член → 403, getMessages не вызван', async () => {
    const { controller, messages } = makeController({
      conversations: { assertMember: vi.fn(async () => false) },
    });
    await expect(
      controller.listMessages('conv_1', {}, USER, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(messages.getMessages).not.toHaveBeenCalled();
  });

  it('член → делегирует в getMessages', async () => {
    const out = { items: [], nextSeq: null };
    const { controller, messages } = makeController({
      conversations: { assertMember: vi.fn(async () => true) },
      messages: { getMessages: vi.fn(async () => out) },
    });
    const res = await controller.listMessages('conv_1', { sinceSeq: '5' }, USER, TENANT);
    expect(res).toBe(out);
    expect(messages.getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', sinceSeq: '5' }),
    );
  });
});

describe('ConversationController POST /message-threads/:id/read', () => {
  it('член → markRead вызван', async () => {
    const { controller, readCursors } = makeController({
      conversations: { assertMember: vi.fn(async () => true) },
    });
    const res = await controller.markRead('conv_1', { cursorSeq: '9' }, USER, TENANT);
    expect(res.ok).toBe(true);
    expect(readCursors.markRead).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      userId: USER.id,
      cursorSeq: '9',
    });
  });

  it('не член → 403', async () => {
    const { controller, readCursors } = makeController({
      conversations: { assertMember: vi.fn(async () => false) },
    });
    await expect(
      controller.markRead('conv_1', { cursorSeq: '9' }, USER, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(readCursors.markRead).not.toHaveBeenCalled();
  });
});

describe('ConversationController POST /conversations/:id/messages/:messageId/reactions', () => {
  it('член → toggleReaction делегирован, возвращает reactions', async () => {
    const { controller, messages } = makeController({
      conversations: { assertMember: vi.fn(async () => true) },
      messages: { toggleReaction: vi.fn(async () => ({ reactions: { '👍': ['user_1'] } })) },
    });
    const res = await controller.toggleReaction(
      'conv_1',
      'm1',
      { emoji: '👍' },
      USER,
      TENANT,
    );
    expect(res.reactions).toEqual({ '👍': ['user_1'] });
    expect(messages.toggleReaction).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      messageId: 'm1',
      userId: USER.id,
      emoji: '👍',
    });
  });
});

describe('ConversationController POST /conversations/company-channel', () => {
  it('owner/admin → ensureCompanyChannel', async () => {
    const { controller, conversations } = makeController({
      rbac: { canWrite: vi.fn(async () => true) },
      conversations: { ensureCompanyChannel: vi.fn(async () => ({ id: 'company_1' }) as never) },
    });
    const res = await controller.companyChannel(USER, TENANT);
    expect(res.conversationId).toBe('company_1');
    expect(conversations.ensureCompanyChannel).toHaveBeenCalledWith(TENANT, USER.id);
  });

  it('не owner/admin → 403', async () => {
    const { controller, conversations } = makeController({
      rbac: { canWrite: vi.fn(async () => false) },
    });
    await expect(controller.companyChannel(USER, TENANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(conversations.ensureCompanyChannel).not.toHaveBeenCalled();
  });
});

describe('ConversationController GET /issues/:id/conversation', () => {
  it('идемпотентно: повторный вызов даёт тот же conversationId', async () => {
    const ensureWorkChat = vi.fn(async () => ({ conversationId: 'conv_work' }));
    const { controller } = makeController({ workChat: { ensureWorkChat } });

    const a = await controller.issueConversation('i1', TENANT);
    const b = await controller.issueConversation('i1', TENANT);

    expect(a.conversationId).toBe('conv_work');
    expect(b.conversationId).toBe('conv_work');
    expect(ensureWorkChat).toHaveBeenCalledTimes(2);
    expect(ensureWorkChat).toHaveBeenCalledWith('i1');
  });

  it('без tenant → 400', async () => {
    const { controller, workChat } = makeController({});
    await expect(controller.issueConversation('i1', undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(workChat.ensureWorkChat).not.toHaveBeenCalled();
  });
});

describe('ConversationController GET /conversations/:id/linked-issue', () => {
  it('возвращает задачу, привязанную к разговору', async () => {
    const getLinkedIssue = vi.fn(async () => ({ id: 'i1', identifier: 'PRJ-7', title: 'T' }));
    const { controller } = makeController({ workChat: { getLinkedIssue } });

    const res = await controller.linkedIssue('conv_1', TENANT);
    expect(res).toEqual({ id: 'i1', identifier: 'PRJ-7', title: 'T' });
  });

  it('нет задачи → 404', async () => {
    const getLinkedIssue = vi.fn(async () => null);
    const { controller } = makeController({ workChat: { getLinkedIssue } });

    await expect(controller.linkedIssue('conv_x', TENANT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
