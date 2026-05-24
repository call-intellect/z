import type { ChannelBinding, Issue, IssueState } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { VoxService } from '../../../ai/services/vox.service';
import type { CommentsService } from '../../../tracker/services/comments.service';
import type { IntakeAutoTriageQueueService } from '../../../tracker/services/intake-auto-triage-queue.service';
import type { IssuesService } from '../../../tracker/services/issues.service';

import type { TelegramApiClient } from './telegram-api-client';
import { TelegramBotMessageHandler } from './telegram-bot-message.handler';
import type {
  TelegramTaskParseResult,
  TelegramTaskParserService,
} from './telegram-task-parser.service';
import type { TelegramBotChannelConfig, TelegramMessage } from './telegram.types';

/**
 * Unit-тесты `TelegramBotMessageHandler` — 4 сценария:
 *   1. text  → parseCreateTask → IntakeIssue + bot-reply.
 *   2. voice → ASR → parseCreateTask + telegram_voice_transcribed metric.
 *   3. forward → parseForwardToTask + telegram_forwards metric.
 *   4. reply на bot-уведомление (с relatedIssueId в payload) → classifyReply →
 *      transitionState или CommentsService.create.
 */

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

function makeVox(): VoxService {
  return {
    submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
    poll: vi.fn().mockResolvedValue({
      status: 'COMPLETED',
      transcriptText: 'голос — задача от иванова на завтра',
      durationSeconds: 5,
    }),
  } as unknown as VoxService;
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

function makeHandler(deps: {
  prisma?: PrismaMock;
  api?: TelegramApiClient;
  vox?: VoxService;
  metrics?: BusinessMetricsService;
  parser?: TelegramTaskParserService;
  cfg?: TypedConfigService;
  issuesService?: IssuesService;
  commentsService?: CommentsService;
  autoTriageQueue?: IntakeAutoTriageQueueService;
} = {}): {
  handler: TelegramBotMessageHandler;
  prisma: PrismaMock;
  api: TelegramApiClient;
  vox: VoxService;
  metrics: BusinessMetricsService;
  parser: TelegramTaskParserService;
  issuesService?: IssuesService;
  commentsService?: CommentsService;
  autoTriageQueue?: IntakeAutoTriageQueueService;
} {
  const prisma = deps.prisma ?? makePrisma();
  const api = deps.api ?? makeApi();
  const vox = deps.vox ?? makeVox();
  const metrics = deps.metrics ?? makeMetrics();
  const parser = deps.parser ?? makeParser();
  const cfg = deps.cfg ?? makeConfig();
  const handler = new TelegramBotMessageHandler(
    prisma as unknown as PrismaService,
    api,
    vox,
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
    vox,
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

describe('TelegramBotMessageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('text → parseCreateTask + bot-reply + metric=created', async () => {
    const { handler, parser, api, metrics } = makeHandler();
    vi.mocked(parser.parseCreateTask).mockResolvedValueOnce(okParseResult());

    const handled = await handler.tryHandle({
      msg: makeMessage({ text: 'Подготовить макет лендинга' }),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });

    expect(handled).toBe(true);
    expect(parser.parseCreateTask).toHaveBeenCalledOnce();
    expect(api.sendMessage).toHaveBeenCalled();
    expect(metrics.incTelegramTasksCreated).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'created',
    });
  });

  it('text + autoTriageEnqueued + auto-triage queue → status=auto_created', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const autoTriageQueue = {
      enqueue,
    } as unknown as IntakeAutoTriageQueueService;
    const { handler, parser, metrics } = makeHandler({ autoTriageQueue });
    vi.mocked(parser.parseCreateTask).mockResolvedValueOnce(
      okParseResult({ autoTriageEnqueued: true, confidence: 0.92 }),
    );
    await handler.tryHandle({
      msg: makeMessage({ text: 'Иванов, завтра 15:00, замерить' }),
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
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

  it('voice → ASR → parseCreateTask + metric incTelegramVoiceTranscribed', async () => {
    const { handler, parser, vox, metrics } = makeHandler();
    vi.mocked(parser.parseCreateTask).mockResolvedValueOnce(okParseResult());

    const msg = makeMessage({
      voice: { file_id: 'voice-1', duration: 5 },
    });
    const handled = await handler.tryHandle({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });
    expect(handled).toBe(true);
    expect(vox.submit).toHaveBeenCalled();
    expect(parser.parseCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        rawText: 'голос — задача от иванова на завтра',
      }),
    );
    expect(metrics.incTelegramVoiceTranscribed).toHaveBeenCalled();
  });

  it('forward → parseForwardToTask + metric incTelegramForwards', async () => {
    const { handler, parser, metrics } = makeHandler();
    vi.mocked(parser.parseForwardToTask).mockResolvedValueOnce(okParseResult());
    const msg = makeMessage({
      text: 'Пересланное сообщение',
      // Эмулируем форвард через поле forward_origin.
    });
    (msg as unknown as Record<string, unknown>).forward_origin = {
      type: 'user',
    };

    const handled = await handler.tryHandle({
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

  it('reply на bot-уведомление с relatedIssueId → classifyReply=accept → transitionState', async () => {
    const transitionState = vi.fn().mockResolvedValue({} as never);
    const issuesService = {
      transitionState,
    } as unknown as IssuesService;
    const { handler, parser, prisma, metrics } = makeHandler({ issuesService });
    // Mock delivery с notification.payload.relatedIssueId.
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
    // Mock issue lookup.
    prisma.issue.findFirst.mockResolvedValueOnce({
      id: 'issue-1',
      tenantId: 'org-1',
      projectId: 'proj-1',
      stateId: 'state-todo',
      dueDate: null,
      deletedAt: null,
    } as unknown as Issue);
    // Mock target state (category=started).
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

    const handled = await handler.tryHandle({
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

  it('reply без delivery match → fall-through, потом text-flow обрабатывает', async () => {
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

    // Если delivery не найден, handleReply возвращает false → но в коде
    // после reply мы пытаемся text → parseCreateTask. Поэтому handler
    // вернёт true (text-flow обработал).
    const parserMock = makeParser();
    vi.mocked(parserMock.parseCreateTask).mockResolvedValueOnce(
      okParseResult(),
    );
    const { handler, parser } = makeHandler({
      prisma,
      parser: parserMock,
    });
    const handled = await handler.tryHandle({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });
    expect(handled).toBe(true);
    expect(parser.parseCreateTask).toHaveBeenCalled();
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
    const handled = await handler.tryHandle({
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
    const handled = await handler.tryHandle({
      msg,
      binding: makeBinding(),
      tenantId: 'org-1',
      config: makeTelegramConfig(),
    });
    expect(handled).toBe(true);
    // sendMessage был вызван с warn-сообщением.
    expect(api.sendMessage).toHaveBeenCalled();
  });
});
