import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { DialogTurn } from '../ai/services/prompts/common';
import { TaskExtractionService } from '../ai/services/task-extraction.service';

import { ChatboxIngestService } from './chatbox-ingest.service';
import {
  type CrossSourceTaskCandidate,
  CrossSourceTaskDedupeService,
} from './cross-source-task-dedupe.service';
import { CHATBOX_ANALYZE_QUEUE, type ChatboxAnalyzeJobData } from './queue/chatbox-analyze.queue';

@Injectable()
export class ChatboxAnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxAnalyzeWorker.name);
  private worker: Worker<ChatboxAnalyzeJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxIngestService)
    private readonly ingest: ChatboxIngestService,
    @Optional()
    @Inject(TaskExtractionService)
    private readonly taskExtractor?: TaskExtractionService,
    @Optional()
    @Inject(CrossSourceTaskDedupeService)
    private readonly taskDedupe?: CrossSourceTaskDedupeService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ChatboxAnalyzeJobData>(
      CHATBOX_ANALYZE_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn({ jobId: job?.id, err: err.message }, 'ChatboxAnalyzeWorker: job failed');
    });
    this.logger.log(`ChatboxAnalyzeWorker запущен (${CHATBOX_ANALYZE_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  async process(job: Job<ChatboxAnalyzeJobData>): Promise<void> {
    const { tenantId, sessionId } = job.data;
    this.logger.debug(
      `ChatboxAnalyze старт: tenant=${tenantId} session=${sessionId} job=${job.id}`,
    );

    try {
      await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId },
        data: { analysisStatus: 'analyzing' },
      });

      const summary = await this.ingest.generateSummary(tenantId, sessionId);
      if (summary !== null) {
        await this.prisma.chatboxChatSession.updateMany({
          where: { id: sessionId, tenantId },
          data: { summary },
        });
      }

      const res = await this.ingest.ingestSession(tenantId, sessionId);
      if (res === null) {
        this.logger.debug(
          `ChatboxAnalyze: session=${sessionId} ещё открыта/нет — остаётся pending`,
        );
        return;
      }

      await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId },
        data: {
          analysisStatus: 'done',
          analyzedAt: new Date(),
          rawEventId: res.rawEventId,
        },
      });
      this.metrics?.incChatboxAnalyze({ status: 'success' });
      this.logger.debug(`ChatboxAnalyze готово: session=${sessionId} rawEventId=${res.rawEventId}`);

      try {
        await this.extractTasks(tenantId, sessionId);
      } catch (taskErr) {
        this.logger.warn(
          {
            tenantId,
            sessionId,
            err: taskErr instanceof Error ? taskErr.message : String(taskErr),
          },
          'ChatboxAnalyze: извлечение задач из переписки упало (игнорируем)',
        );
      }
    } catch (err) {
      await this.prisma.chatboxChatSession
        .updateMany({
          where: { id: sessionId, tenantId },
          data: { analysisStatus: 'failed' },
        })
        .catch(() => undefined);
      this.metrics?.incChatboxAnalyze({ status: 'failed' });
      this.logger.error(
        {
          tenantId,
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ChatboxAnalyze: ошибка анализа сессии',
      );
      throw err;
    }
  }

  async extractTasks(tenantId: string, sessionId: string): Promise<void> {
    const enabled = this.cfg?.aiFeatures.chatboxTaskExtractionEnabled ?? false;
    if (!enabled || !this.taskExtractor || !this.taskDedupe) {
      return;
    }

    const [existingByTask, existingBySource] = await Promise.all([
      this.prisma.task.findFirst({
        where: { tenantId, sourceChatSessionId: sessionId },
        select: { id: true },
      }),
      this.prisma.taskSource.findFirst({
        where: { tenantId, sourceType: 'chatbox', sourceRefId: sessionId },
        select: { id: true },
      }),
    ]);
    if (existingByTask || existingBySource) {
      this.logger.debug(
        `ChatboxAnalyze: задачи для session=${sessionId} уже извлечены — пропуск (идемпотентность)`,
      );
      return;
    }

    const session = await this.prisma.chatboxChatSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true, chatId: true },
    });
    if (!session) return;

    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: session.chatId, tenantId },
      select: {
        id: true,
        externalId: true,
        customerExternalId: true,
        responsibleExternalId: true,
      },
    });

    const messages = await this.prisma.chatboxMessage.findMany({
      where: { tenantId, sessionId },
      orderBy: { externalCreatedAt: 'asc' },
      select: {
        senderType: true,
        senderName: true,
        text: true,
        contentType: true,
      },
    });
    if (messages.length === 0) return;

    const dialog: DialogTurn[] = messages.map((m, i) => {
      const isClient = m.senderType === 'CLIENT';
      const role = isClient ? 'Клиент' : 'Менеджер';
      const name = m.senderName ? ` [${m.senderName}]` : '';
      const body =
        m.contentType !== 'TEXT' || !m.text || m.text.trim() === '' ? `[${m.contentType}]` : m.text;
      return {
        speaker: `${role}${name}`,
        text: body,
        startSec: i,
        endSec: i + 0.9,
        speakerParticipantId: null,
      };
    });

    let assigneeUserId: string | null = null;
    let assigneeRaw: string | null = null;
    if (chat?.responsibleExternalId) {
      const member = await this.prisma.chatboxMember.findUnique({
        where: {
          tenantId_externalId: {
            tenantId,
            externalId: chat.responsibleExternalId,
          },
        },
        select: { name: true, linkedPersonId: true },
      });
      assigneeRaw = member?.name ?? null;
      if (member?.linkedPersonId) {
        const person = await this.prisma.person.findFirst({
          where: { id: member.linkedPersonId, tenantId },
          select: { userId: true, name: true },
        });
        assigneeUserId = person?.userId ?? null;
        assigneeRaw = assigneeRaw ?? person?.name ?? null;
      }
    }

    let customerName: string | null = null;
    if (chat?.customerExternalId) {
      const customer = await this.prisma.chatboxCustomer.findUnique({
        where: {
          tenantId_externalId: {
            tenantId,
            externalId: chat.customerExternalId,
          },
        },
        select: { name: true },
      });
      customerName = customer?.name ?? null;
    }
    const title = customerName
      ? `Переписка с клиентом: ${customerName}`
      : `Переписка ${chat?.externalId ?? session.chatId}`;

    const ownerUserId = await this.resolveOwnerUserId(tenantId, assigneeUserId);
    if (!ownerUserId) {
      this.logger.warn(
        `ChatboxAnalyze: не найден владелец-fallback для session=${sessionId} tenant=${tenantId} — пропуск задач`,
      );
      return;
    }

    const extracted = await this.taskExtractor.extractTasks({
      meetingId: session.chatId,
      tenantId,
      meeting: { id: session.chatId, type: 'chatbox', title },
      dialog,
    });
    if (extracted.length === 0) {
      this.logger.debug(`ChatboxAnalyze: разборщик не нашёл задач в session=${sessionId}`);
      return;
    }

    const candidates: CrossSourceTaskCandidate[] = extracted.map((t) => ({
      title: t.title,
      description: t.description ?? null,
      assigneeRaw,
      assigneeUserId,
      sourceQuote: t.sourceQuote,
      confidence: t.confidence,
    }));

    const result = await this.taskDedupe.processCandidates(candidates, {
      tenantId,
      ownerUserId,
      sessionId,
      chatId: session.chatId,
    });
    this.logger.debug(
      `ChatboxAnalyze: задачи session=${sessionId} created=${result.created} linked=${result.linked}`,
    );
  }

  private async resolveOwnerUserId(
    tenantId: string,
    assigneeUserId: string | null,
  ): Promise<string | null> {
    if (assigneeUserId) return assigneeUserId;
    const ownerMembership = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, role: 'owner' },
      select: { userId: true },
      orderBy: { joinedAt: 'asc' },
    });
    return ownerMembership?.userId ?? null;
  }
}
