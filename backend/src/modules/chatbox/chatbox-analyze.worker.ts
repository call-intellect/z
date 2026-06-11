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
import {
  CHATBOX_ANALYZE_QUEUE,
  type ChatboxAnalyzeJobData,
} from './queue/chatbox-analyze.queue';

/**
 * Worker очереди `chatbox.analyze` (ТЗ 2026-06-05, Фаза 5).
 *
 * Один job → анализ одной закрытой сессии чата:
 *   1. `analysisStatus='analyzing'`.
 *   2. best-effort LLM-summary (ChatboxIngestService.generateSummary) →
 *      persist в `summary` (если не null).
 *   3. мост в knowledge-core (ChatboxIngestService.ingestSession). Если null
 *      (сессия ещё открыта / отсутствует) — оставляем `pending`, вернёмся позже.
 *   4. при успехе моста → `analysisStatus='done'`, `analyzedAt`, `rawEventId`.
 *   4b. ТЗ 2026-06-11 chatbox-tasks Ф5 — задачи из переписки: тем же
 *       разборщиком, что и встреча (`TaskExtractionService`), с единым
 *       межисточниковым дедупом (`CrossSourceTaskDedupeService`, Ф6). За
 *       kill-switch `chatbox.taskExtraction.enabled` (ON). Best-effort —
 *       ошибка извлечения задач НЕ роняет анализ (сессия уже 'done').
 *   5. при ошибке → `analysisStatus='failed'` + rethrow (BullMQ сделает retry
 *      по attempts из CHATBOX_ANALYZE_JOB_OPTIONS).
 *
 * Регистрируется в WorkersModule (in-process, как остальные воркеры).
 */
@Injectable()
export class ChatboxAnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxAnalyzeWorker.name);
  private worker: Worker<ChatboxAnalyzeJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxIngestService)
    private readonly ingest: ChatboxIngestService,
    // Ф5 — извлечение задач из переписки (тот же разборщик, что и у встречи).
    @Optional()
    @Inject(TaskExtractionService)
    private readonly taskExtractor?: TaskExtractionService,
    // Ф6 — единый межисточниковый дедуп задач (link vs create).
    @Optional()
    @Inject(CrossSourceTaskDedupeService)
    private readonly taskDedupe?: CrossSourceTaskDedupeService,
    // Kill-switch chatbox.taskExtraction.enabled (Ship-On, default ON).
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    // Метрики анализа (Ф3). @Optional — тесты без метрик-сервиса не падают.
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
      this.logger.warn(
        { jobId: job?.id, err: err.message },
        'ChatboxAnalyzeWorker: job failed',
      );
    });
    this.logger.log(`ChatboxAnalyzeWorker запущен (${CHATBOX_ANALYZE_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для тестирования. */
  async process(job: Job<ChatboxAnalyzeJobData>): Promise<void> {
    const { tenantId, sessionId } = job.data;
    this.logger.log(
      `ChatboxAnalyze старт: tenant=${tenantId} session=${sessionId} job=${job.id}`,
    );

    try {
      // 1. Помечаем сессию «в анализе» (tenant-scoped updateMany).
      await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId },
        data: { analysisStatus: 'analyzing' },
      });

      // 2. Best-effort LLM-summary — persist только при наличии.
      const summary = await this.ingest.generateSummary(tenantId, sessionId);
      if (summary !== null) {
        await this.prisma.chatboxChatSession.updateMany({
          where: { id: sessionId, tenantId },
          data: { summary },
        });
      }

      // 3. Мост в knowledge-core. null → сессия ещё открыта/отсутствует:
      //    оставляем pending (sweeper-cron вернётся позже).
      const res = await this.ingest.ingestSession(tenantId, sessionId);
      if (res === null) {
        this.logger.log(
          `ChatboxAnalyze: session=${sessionId} ещё открыта/нет — остаётся pending`,
        );
        return;
      }

      // 4. Успех — фиксируем результат.
      await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId },
        data: {
          analysisStatus: 'done',
          analyzedAt: new Date(),
          rawEventId: res.rawEventId,
        },
      });
      // Метрика анализа (Ф3): сессия успешно доведена до 'done'.
      this.metrics?.incChatboxAnalyze({ status: 'success' });
      this.logger.log(
        `ChatboxAnalyze готово: session=${sessionId} rawEventId=${res.rawEventId}`,
      );

      // 4b. Ф5 — задачи из переписки (best-effort). Ошибка извлечения задач НЕ
      //     должна валить анализ (сессия уже 'done', память/граф записаны).
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
      // 5. Помечаем failed (best-effort) и пробрасываем для retry BullMQ.
      await this.prisma.chatboxChatSession
        .updateMany({
          where: { id: sessionId, tenantId },
          data: { analysisStatus: 'failed' },
        })
        .catch(() => undefined);
      // Метрика анализа (Ф3): сессия упала в 'failed'.
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

  /**
   * Ф5 — извлечение задач из закрытой сессии чата тем же разборщиком, что и
   * встреча (`TaskExtractionService`), запись через единый межисточниковый
   * дедуп (`CrossSourceTaskDedupeService`, Ф6).
   *
   * Шаги:
   *   1. kill-switch `chatbox.taskExtraction.enabled` (default ON) + наличие
   *      зависимостей (taskExtractor/taskDedupe). OFF → no-op.
   *   2. Идемпотентность: если по сессии уже есть `Task.sourceChatSessionId` ИЛИ
   *      `TaskSource(chatbox, sourceRefId=sessionId)` — повторный анализ задачи
   *      не плодит.
   *   3. Построить `dialog: DialogTurn[]` из сообщений (клиент/менеджер — как в
   *      chatbox-ingest), вызвать `extractTasks` с источником
   *      `{ id: chatId, type:'chatbox', title }`.
   *   4. Резолв ответственного: chat.responsibleExternalId → ChatboxMember
   *      .linkedPersonId → Person.userId (best-effort; клиент НЕ ответственный).
   *   5. Записать кандидатов через дедуп-сервис.
   *
   * Public для unit-тестирования.
   */
  async extractTasks(tenantId: string, sessionId: string): Promise<void> {
    // 1. Kill-switch + зависимости.
    const enabled = this.cfg?.aiFeatures.chatboxTaskExtractionEnabled ?? false;
    if (!enabled || !this.taskExtractor || !this.taskDedupe) {
      return;
    }

    // 2. Идемпотентность по сессии.
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
      this.logger.log(
        `ChatboxAnalyze: задачи для session=${sessionId} уже извлечены — пропуск (идемпотентность)`,
      );
      return;
    }

    // Сессия + чат (для chatId/responsibleExternalId/тема).
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

    // 3. Построение dialog (зеркалит chatbox-ingest transcript.turns):
    //    клиент → «Клиент [имя]», иначе «Менеджер [имя]». Синтетические
    //    таймкоды (1 сообщение = 1 секунда). Не-TEXT/пустые → [contentType].
    const dialog: DialogTurn[] = messages.map((m, i) => {
      const isClient = m.senderType === 'CLIENT';
      const role = isClient ? 'Клиент' : 'Менеджер';
      const name = m.senderName ? ` [${m.senderName}]` : '';
      const body =
        m.contentType !== 'TEXT' || !m.text || m.text.trim() === ''
          ? `[${m.contentType}]`
          : m.text;
      return {
        speaker: `${role}${name}`,
        text: body,
        startSec: i,
        endSec: i + 0.9,
        speakerParticipantId: null,
      };
    });

    // 4. Резолв ответственного менеджера → Person.userId. Клиент НИКОГДА не
    //    ответственный (не сотрудник). Best-effort: userId=null → задача без
    //    assigneeUserId, assigneeRaw хранит имя.
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

    // Тема для meeting-дескриптора: имя клиента (если резолвится) либо чат.
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

    // Владелец-fallback задачи (Task.userId — NOT NULL). Назначенный менеджер,
    // иначе — владелец Org (Membership role=owner).
    const ownerUserId = await this.resolveOwnerUserId(tenantId, assigneeUserId);
    if (!ownerUserId) {
      this.logger.warn(
        `ChatboxAnalyze: не найден владелец-fallback для session=${sessionId} tenant=${tenantId} — пропуск задач`,
      );
      return;
    }

    // Вызов разборщика. meetingId — placeholder (chatId): на запись задач он НЕ
    // переносится (meetingId=null для chatbox-задач).
    const extracted = await this.taskExtractor.extractTasks({
      meetingId: session.chatId,
      tenantId,
      meeting: { id: session.chatId, type: 'chatbox', title },
      dialog,
    });
    if (extracted.length === 0) {
      this.logger.log(
        `ChatboxAnalyze: разборщик не нашёл задач в session=${sessionId}`,
      );
      return;
    }

    // 5. Кандидаты → единый межисточниковый дедуп (link vs create).
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
    this.logger.log(
      `ChatboxAnalyze: задачи session=${sessionId} created=${result.created} linked=${result.linked}`,
    );
  }

  /**
   * Владелец-fallback для `Task.userId` (NOT NULL). Сначала — назначенный
   * менеджер (если резолвлен в User), иначе — владелец Org (Membership
   * role='owner'). Возвращает null, если не нашли никого (тогда задачи не
   * пишем — без userId Task невалиден).
   */
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
