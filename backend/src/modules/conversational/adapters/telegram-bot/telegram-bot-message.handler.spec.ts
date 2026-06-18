import type { ChannelBinding, Issue, IssueState } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { CommentsService } from '../../../tracker/services/comments.service';
import type { IntakeAutoTriageQueueService } from '../../../tracker/services/intake-auto-triage-queue.service';
import type { IssuesService } from '../../../tracker/services/issues.service';

import type { TelegramApiClient } from './telegram-api-client';
import { TelegramBotMessageHandler, renderMyTasksText } from './telegram-bot-message.handler';
import type {
  TelegramTaskParseResult,
  TelegramTaskParserService,
} from './telegram-task-parser.service';
import type { TelegramBotChannelConfig, TelegramMessage } from './telegram.types';

interface PrismaMock {
  notificationDelivery: { findFirst: ReturnType<typeof vi.fn> };
  issue: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  issueState: { findFirst: ReturnType<typeof vi.fn> };
}

function makePrisma(): PrismaMock {
  return {
    notificationDelivery: { findFirst: vi.fn() },
    issue: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    issueState: { findFirst: vi.fn() },
  };
}

function makeApi(): TelegramApiClient {
  return {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 1, chatId: 100 }),
    getFile: vi.fn().mockResolvedValue({ file_path: 'voice/file.ogg' }),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('audio')),
  } as unknown as TelegramApiClient;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incTelegramTasksCreated: vi.fn(),
    incTelegramVoiceTranscribed: vi.fn(),
    incTelegramForwards: vi.fn(),
    incTelegramReplyClassified: vi.fn(),
  } as unknown as BusinessMetricsService;
}

function makeParser(): TelegramTaskParserService {
  return {
    parseCreateTask: vi.fn(),
    parseForwardToTask: vi.fn(),
    classifyReply: vi.fn(),
    formulateDigest: vi.fn(),
  } as unknown as TelegramTaskParserService;
}

function makeConfig(): TypedConfigService {
  return {
    bot: {
      voiceEnabled: true,
      documentEnabled: true,
      intentClassifierEnabled: true,
    },
  } as unknown as TypedConfigService;
}

function makeBinding(): ChannelBinding {
  return {
    id: 'binding-1',
    userId: 'user-1',
    channelId: 'channel-1',
    externalId: 'tg-12345',
    verifiedAt: new Date(),
    preferences: null,
    linkedAt: new Date(),
  } as unknown as ChannelBinding;
}

function makeTelegramConfig(): TelegramBotChannelConfig {
  return {
    botToken: 'plain-token',
    webhookSecret: 'secret',
    botUsername: 'kora_bot',
  };
}

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 67,
    date: 1234567890,
    chat: { id: 12345 },
    from: { id: 12345, first_name: 'User' },
    ...overrides,
  } as TelegramMessage;
}

function makeHandler(
  deps: {
    prisma?: PrismaMock;
    api?: TelegramApiClient;
    metrics?: BusinessMetricsService;
    parser?: TelegramTaskParserService;
    cfg?: TypedConfigService;
    issuesService?: IssuesService;
    commentsService?: CommentsService;
    autoTriageQueue?: IntakeAutoTriageQueueService;
  } = {},
): {
  handler: TelegramBotMessageHandler;
  prisma: PrismaMock;
  api: TelegramApiClient;
  metrics: BusinessMetricsService;
  parser: TelegramTaskParserService;
  issuesService?: IssuesService;
  commentsService?: CommentsService;
  autoTriageQueue?: IntakeAutoTriageQueueService;
} {
  const prisma = deps.prisma ?? makePrisma();
  const api = deps.api ?? makeApi();
  const metrics = deps.metrics ?? makeMetrics();
  const parser = deps.parser ?? makeParser();
  const cfg = deps.cfg ?? makeConfig();
  const handler = new TelegramBotMessageHandler(
    prisma as unknown as PrismaService,
    api,
    metrics,
    parser,
    cfg,
    deps.issuesService,
    deps.commentsService,
    deps.autoTriageQueue,
  );
  return {
    handler,
    prisma,
    api,
    metrics,
    parser,
    issuesService: deps.issuesService,
    commentsService: deps.commentsService,
    autoTriageQueue: deps.autoTriageQueue,
  };
}

function okParseResult(over: Partial<TelegramTaskParseResult> = {}): TelegramTaskParseResult {
  return {
    intakeIssueId: 'intake-1',
    autoTriageEnqueued: false,
    confidence: 0.6,
    suggested: {
      title: 'Подготовить макет',
      suggestedAssigneeId: null,
      suggestedProjectId: null,
      suggestedDueDate: null,
      suggestedPriority: null,
    },
    reason: 'ok',
    ...over,
  };
}

describe('renderMyTasksText', () => {
  it('пусто → «Открытых задач нет»', () => {
    expect(renderMyTasksText([], 0, 10)).toContain('Открытых задач нет');
  });

  it('список → «Ваши задачи (N):» + буллеты + дедлайн', () => {
    const out = renderMyTasksText(
      [
        {
          identifier: 'KORA-1',
          title: 'Подготовить КП',
          stateName: 'В работе',
          dueDate: new Date('2026-06-12T00:00:00.000Z'),
        },
        { identifier: 'KORA-2', title: 'Созвон', stateName: 'Бэклог', dueDate: null },
      ],
      2,
      10,
    );
    expect(out).toContain('Ваши задачи (2):');
    expect(out).toContain('• Подготовить КП — до 2026-06-12');
    expect(out).toContain('• Созвон');
    expect(out).not.toContain('и ещё');
  });

  it('total>limit → «…и ещё M в кабинете»', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      identifier: `KORA-${i}`,
      title: `Задача ${i}`,
      stateName: null,
      dueDate: null,
    }));
    const out = renderMyTasksText(items, 23, 10);
    expect(out).toContain('Ваши задачи (23):');
    expect(out).toContain('…и ещё 13 в кабинете.');
  });

  it('HTML в названии экранируется (бот шлёт parseMode=HTML)', () => {
    const out = renderMyTasksText(
      [{ identifier: 'KORA-1', title: 'Фикс <script> & «баг»', stateName: null, dueDate: null }],
      1,
      10,
    );
    expect(out).toContain('&lt;script&gt; &amp; «баг»');
    expect(out).not.toContain('<script>');
  });
});

describe('TelegramBotMessageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleCreateTask → parseCreateTask + bot-reply + metric=created', async () => {
    const { handler, parser, api, metrics } = makeHandler();
    vi.mocked(parser.parseCreateTask).mockResolvedValueOnce(okParseResult());

    await handler.handleCreateTask({
      msg: makeMessage({ text: 'Подготовить макет лендинга' }),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
      text: 'Подготовить макет лендинга',
      externalId: '12345:67',
    });

    expect(parser.parseCreateTask).toHaveBeenCalledOnce();
    expect(api.sendMessage).toHaveBeenCalled();
    expect(metrics.incTelegramTasksCreated).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'created',
    });
  });

  it('handleCreateTask + autoTriageEnqueued → status=auto_created', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const autoTriageQueue = {
      enqueue,
    } as unknown as IntakeAutoTriageQueueService;
    const { handler, parser, metrics } = makeHandler({ autoTriageQueue });
    vi.mocked(parser.parseCreateTask).mockResolvedValueOnce(
      okParseResult({ autoTriageEnqueued: true, confidence: 0.92 }),
    );
    await handler.handleCreateTask({
      msg: makeMessage({ text: 'Иванов, завтра 15:00, замерить' }),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
      text: 'Иванов, завтра 15:00, замерить',
      externalId: '12345:67',
    });
    expect(enqueue).toHaveBeenCalledWith({
      tenantId: 'org-1',
      intakeIssueId: 'intake-1',
    });
    expect(metrics.incTelegramTasksCreated).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'auto_created',
    });
  });

  it('handleShowTasks → listOpenForAssignee + reply со списком', async () => {
    const listOpenForAssignee = vi.fn().mockResolvedValue({
      items: [
        { identifier: 'KORA-1', title: 'Подготовить КП', stateName: 'В работе', dueDate: null },
      ],
      total: 1,
    });
    const issuesService = { listOpenForAssignee } as unknown as IssuesService;
    const { handler, api } = makeHandler({ issuesService });

    await handler.handleShowTasks({
      msg: makeMessage(),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });

    expect(listOpenForAssignee).toHaveBeenCalledWith({
      tenantId: 'org-1',
      userId: 'user-1',
      limit: expect.any(Number),
    });
    expect(api.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Ваши задачи (1):'),
      }),
    );
  });

  it('handleShowTasks без трекера (degraded) → мягкий ответ, listOpenForAssignee не зовётся', async () => {
    const { handler, api } = makeHandler();

    await handler.handleShowTasks({
      msg: makeMessage(),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });

    expect(api.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Откройте раздел'),
      }),
    );
  });

  it('handleShowTasks пусто → «Открытых задач нет»', async () => {
    const listOpenForAssignee = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const issuesService = { listOpenForAssignee } as unknown as IssuesService;
    const { handler, api } = makeHandler({ issuesService });

    await handler.handleShowTasks({
      msg: makeMessage(),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });

    expect(api.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Открытых задач нет'),
      }),
    );
  });

  it('forward → parseForwardToTask + metric incTelegramForwards', async () => {
    const { handler, parser, metrics } = makeHandler();
    vi.mocked(parser.parseForwardToTask).mockResolvedValueOnce(okParseResult());
    const msg = makeMessage({ text: 'Пересланное сообщение' });
    (msg as unknown as Record<string, unknown>).forward_origin = {
      type: 'user',
    };

    const handled = await handler.tryHandleStructural({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });

    expect(handled).toBe(true);
    expect(parser.parseForwardToTask).toHaveBeenCalledOnce();
    expect(metrics.incTelegramForwards).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'created',
    });
  });

  it('plain text (не forward/reply) → tryHandleStructural=false, parseCreateTask НЕ зовётся (гейт намерения)', async () => {
    const { handler, parser } = makeHandler();

    const handled = await handler.tryHandleStructural({
      msg: makeMessage({ text: 'сегодня в планах добить три задачи' }),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });

    expect(handled).toBe(false);
    expect(parser.parseCreateTask).not.toHaveBeenCalled();
  });

  it('reply на bot-уведомление с relatedIssueId → classifyReply=accept → transitionState', async () => {
    const transitionState = vi.fn().mockResolvedValue({} as never);
    const issuesService = {
      transitionState,
    } as unknown as IssuesService;
    const { handler, parser, prisma, metrics } = makeHandler({ issuesService });
    prisma.notificationDelivery.findFirst.mockResolvedValueOnce({
      id: 'd-1',
      channelBindingId: 'binding-1',
      externalMessageId: '12345:100',
      notification: {
        id: 'notif-1',
        payload: { relatedIssueId: 'issue-1' },
        responseStatus: null,
      },
    });
    prisma.issue.findFirst.mockResolvedValueOnce({
      id: 'issue-1',
      tenantId: 'org-1',
      projectId: 'proj-1',
      stateId: 'state-todo',
      dueDate: null,
      deletedAt: null,
    } as unknown as Issue);
    prisma.issueState.findFirst.mockResolvedValueOnce({
      id: 'state-in-progress',
      category: 'started',
    } as unknown as IssueState);

    vi.mocked(parser.classifyReply).mockResolvedValueOnce({
      kind: 'status_command',
      action: 'accept',
    });

    const msg = makeMessage({
      text: 'принял',
      reply_to_message: {
        message_id: 100,
        date: 1234,
        chat: { id: 12345 },
      } as TelegramMessage,
    });

    const handled = await handler.tryHandleStructural({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });
    expect(handled).toBe(true);
    expect(transitionState).toHaveBeenCalledWith(
      'issue-1',
      { stateId: 'state-in-progress', reason: 'telegram_reply' },
      'org-1',
      'user-1',
    );
    expect(metrics.incTelegramReplyClassified).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      kind: 'status_command',
    });
  });

  it('reply без delivery match → tryHandleStructural=false (адаптер классифицирует), parseCreateTask НЕ зовётся', async () => {
    const prisma = makePrisma();
    prisma.notificationDelivery.findFirst.mockResolvedValueOnce(null);
    const msg = makeMessage({
      text: 'хочу новую задачу',
      reply_to_message: {
        message_id: 100,
        date: 1234,
        chat: { id: 12345 },
      } as TelegramMessage,
    });
    const parserMock = makeParser();
    const { handler, parser } = makeHandler({ prisma, parser: parserMock });

    const handled = await handler.tryHandleStructural({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });
    expect(handled).toBe(false);
    expect(parser.parseCreateTask).not.toHaveBeenCalled();
  });

  it('reply comment → CommentsService.create', async () => {
    const create = vi.fn().mockResolvedValue({} as never);
    const commentsService = {
      create,
    } as unknown as CommentsService;
    const { handler, parser, prisma } = makeHandler({ commentsService });
    prisma.notificationDelivery.findFirst.mockResolvedValueOnce({
      id: 'd-1',
      channelBindingId: 'binding-1',
      notification: {
        id: 'notif-1',
        payload: { issueId: 'issue-1' },
        responseStatus: null,
      },
    });
    prisma.issue.findFirst.mockResolvedValueOnce({
      id: 'issue-1',
      tenantId: 'org-1',
      projectId: 'proj-1',
      stateId: 'state-todo',
      dueDate: null,
      deletedAt: null,
    } as unknown as Issue);
    vi.mocked(parser.classifyReply).mockResolvedValueOnce({
      kind: 'comment',
      text: 'Уточнил у заказчика, всё ок',
    });

    const msg = makeMessage({
      text: 'уточнил у заказчика всё ок',
      reply_to_message: {
        message_id: 100,
        date: 1234,
        chat: { id: 12345 },
      } as TelegramMessage,
    });
    const handled = await handler.tryHandleStructural({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });
    expect(handled).toBe(true);
    expect(create).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({
        content: 'Уточнил у заказчика, всё ок',
        access: 'internal',
      }),
      'org-1',
      'user-1',
    );
  });

  it('status_command в degraded mode (IssuesService=undefined) → warn-reply', async () => {
    const { handler, parser, api, prisma } = makeHandler();
    prisma.notificationDelivery.findFirst.mockResolvedValueOnce({
      id: 'd-1',
      channelBindingId: 'binding-1',
      notification: {
        id: 'notif-1',
        payload: { relatedIssueId: 'issue-1' },
        responseStatus: null,
      },
    });
    prisma.issue.findFirst.mockResolvedValueOnce({
      id: 'issue-1',
      tenantId: 'org-1',
      projectId: 'proj-1',
      stateId: 'state-todo',
      dueDate: null,
      deletedAt: null,
    } as unknown as Issue);
    vi.mocked(parser.classifyReply).mockResolvedValueOnce({
      kind: 'status_command',
      action: 'accept',
    });
    const msg = makeMessage({
      text: 'принял',
      reply_to_message: {
        message_id: 100,
        date: 1234,
        chat: { id: 12345 },
      } as TelegramMessage,
    });
    const handled = await handler.tryHandleStructural({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });
    expect(handled).toBe(true);
    expect(api.sendMessage).toHaveBeenCalled();
  });
});
