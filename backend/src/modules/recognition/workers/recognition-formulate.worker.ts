import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  CORE_QUEUE_NAMES,
  type RecognitionFormulateJobData,
} from '../../core-queue/queues';
import {
  RECOGNITION_FORMULATE_JSON_SCHEMA,
  RECOGNITION_FORMULATE_SCHEMA_NAME,
  RECOGNITION_FORMULATE_SYSTEM_PROMPT,
  RECOGNITION_FORMULATE_USER_TEMPLATE,
  recognitionFallbackMessage,
} from '../prompts/recognition-formulate.prompt';

/**
 * Wave 2 finishing (A2) — маппинг recognition.type → читаемый title (заголовок
 * для ActivityFeedItem). Не дублирует message — message формирует LLM или
 * fallback (большой тёплый текст), title — короткая шапка для UI.
 */
function recognitionFeedTitle(type: string): string {
  switch (type) {
    case 'thanks_comment':
      return 'Благодарность за комментарий';
    case 'thanks_helpfulness':
      return 'Благодарность за помощь команде';
    case 'mention_helped':
      return 'Коллега отметил твою помощь';
    case 'idea_shipped':
      return 'Идея взята в работу';
    case 'streak_milestone':
      return 'Серия чек-инов';
    case 'weekly_summary':
      return 'Итоги недели';
    default:
      return 'Благодарность';
  }
}

function recognitionFeedIcon(
  type: string,
): 'bulb' | 'check' | 'thumbs' {
  if (type === 'idea_shipped') return 'bulb';
  if (type === 'streak_milestone' || type === 'weekly_summary') return 'check';
  return 'thumbs';
}

/**
 * Wave 2 — RecognitionFormulateWorker.
 *
 * Consumer `core.recognition-formulate`. На каждый job:
 *   1. Если `message` уже задан в payload — пропускаем LLM-шаг.
 *   2. Иначе — LLM `recognition-formulate` (JSON Schema, strict). На ошибку
 *      / пустую строку → deterministic fallback (см. prompt).
 *   3. Создаём запись `Recognition` (`visibility` по умолчанию 'private').
 *   4. Если visibility ∈ {team, public_org} — публикуем в Activity Feed
 *      (TODO: ActivityFeedService ещё не реализован — Agent 14/15 ставят
 *      его параллельно. На 2026-05-24 оставляем только log + Recognition в БД).
 *
 * Этическая защита (см. ТЗ §8):
 *   - fromUserId сохраняется (если был передан), но message формируется AI,
 *     а не подделывается под голос человека. См. prompt.
 *   - Если message получился пустой — записываем deterministic fallback, чтобы
 *     UI не показывал «пустой» Recognition.
 */
@Injectable()
export class RecognitionFormulateWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RecognitionFormulateWorker.name);
  private worker: Worker<RecognitionFormulateJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(ActivityFeedService)
    private readonly feed: ActivityFeedService | null = null,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<RecognitionFormulateJobData>(
      CORE_QUEUE_NAMES.RECOGNITION_FORMULATE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobId: job?.id,
          type: job?.data?.type,
          toUserId: job?.data?.toUserId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'recognition-formulate: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `RecognitionFormulateWorker запущен (${CORE_QUEUE_NAMES.RECOGNITION_FORMULATE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<RecognitionFormulateJobData>): Promise<void> {
    const data = job.data;

    // 1. Проверка идемпотентности на уровне БД: если уже создавали
    //    Recognition для того же контекста / type / получателя — выходим.
    //    BullMQ jobId этого, в принципе, не пропустит, но защита от
    //    параллельной публикации из разных мест.
    const existing = await this.prisma.recognition.findFirst({
      where: {
        tenantId: data.tenantId,
        toUserId: data.toUserId,
        type: data.type,
        contextEntityId: data.contextEntityId ?? null,
        contextEntityType: data.contextEntityType ?? null,
        fromUserId: data.fromUserId ?? null,
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `recognition skip: уже создана (id=${existing.id}, type=${data.type}, toUserId=${data.toUserId})`,
      );
      return;
    }

    // 2. message: либо прислали готовый, либо формулируем через LLM.
    const message =
      data.message && data.message.trim().length > 0
        ? data.message.slice(0, 400)
        : await this.formulateMessage(data);

    // 3. Создаём Recognition в БД.
    const visibility = data.visibility ?? 'private';
    const created = await this.prisma.recognition.create({
      data: {
        tenantId: data.tenantId,
        fromUserId: data.fromUserId ?? null,
        toUserId: data.toUserId,
        type: data.type,
        contextEntityType: data.contextEntityType ?? null,
        contextEntityId: data.contextEntityId ?? null,
        message,
        visibility,
      },
    });
    this.logger.log(
      `recognition created: id=${created.id} type=${data.type} toUserId=${data.toUserId} from=${data.fromUserId ?? 'ai'} visibility=${visibility}`,
    );

    // 4. Публикация в Activity Feed (если visibility > private).
    //    Wave 2 A2: best-effort — Recognition уже сохранён, упавший publish не
    //    ломает worker (warn-лог, BullMQ не повторяет job).
    if (visibility !== 'private') {
      if (!this.feed) {
        this.logger.debug(
          `recognition skip feed publish: ActivityFeedService недоступен (id=${created.id})`,
        );
        return;
      }
      try {
        await this.feed.publish({
          tenantId: data.tenantId,
          feedType: 'recognition',
          sourceType: 'ai_agent',
          sourceAgentName: 'recognition_agent',
          relatedEntityType: 'recognition',
          relatedEntityId: created.id,
          title: recognitionFeedTitle(data.type),
          summary: message,
          iconType: recognitionFeedIcon(data.type),
          severity: 'normal',
          visibility,
          targetUserId: data.toUserId,
        });
      } catch (err) {
        this.logger.warn(
          {
            recognitionId: created.id,
            type: data.type,
            visibility,
            err: err instanceof Error ? err.message : String(err),
          },
          'recognition: ActivityFeed publish упал — Recognition сохранён, лента best-effort',
        );
      }
    }
  }

  /** LLM `recognition-formulate` с fallback. */
  private async formulateMessage(
    data: RecognitionFormulateJobData,
  ): Promise<string> {
    // Подтягиваем имена для контекста промпта (тёплое обращение). Лёгкие
    // запросы — два по PK.
    const [toUser, fromUser] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: data.toUserId },
        select: { name: true },
      }),
      data.fromUserId
        ? this.prisma.user.findUnique({
            where: { id: data.fromUserId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    const fallback = recognitionFallbackMessage({
      type: data.type,
      payload: data.contextPayload,
    });

    try {
      const result = await this.llm.call({
        taskType: 'recognition-formulate',
        systemPrompt: RECOGNITION_FORMULATE_SYSTEM_PROMPT,
        userMessage: RECOGNITION_FORMULATE_USER_TEMPLATE({
          type: data.type,
          toUserName: toUser?.name ?? null,
          fromUserName: fromUser?.name ?? null,
          payload: data.contextPayload,
        }),
        tenantId: data.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: RECOGNITION_FORMULATE_SCHEMA_NAME,
          schema: RECOGNITION_FORMULATE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: data.contextEntityId
          ? { type: data.contextEntityType ?? 'recognition', id: data.contextEntityId }
          : null,
        dataClass: 'internal',
      });
      const parsed = JSON.parse(result.text) as { message?: string };
      const msg = (parsed?.message ?? '').trim();
      if (msg.length === 0) {
        return fallback;
      }
      return msg.slice(0, 400);
    } catch (err) {
      this.logger.debug(
        {
          type: data.type,
          toUserId: data.toUserId,
          err: err instanceof Error ? err.message : String(err),
        },
        'recognition-formulate LLM упал — используем fallback',
      );
      return fallback;
    }
  }
}
