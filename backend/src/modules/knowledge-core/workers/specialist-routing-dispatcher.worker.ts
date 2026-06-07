import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CORE_QUEUE_NAMES } from '../../core-queue/queues';
import {
  deriveTraceFromJob,
  PipelineRunner,
  SystemLogPipeline,
  traceForMeeting,
} from '../../logging/log-pipeline';
import { PersonalRelationBuilderWorker } from '../../operations/workers/personal-relation-builder.worker';
import { RoleMapBuilderWorker } from '../../role-map/workers/role-map-builder.worker';
import { Specialist38HelpfulnessWorker } from '../../specialist-3-8-helpfulness/workers/specialist-3-8-helpfulness.worker';

import { ExperimentDetectorWorker } from './experiment-detector.worker';
import { ProcessDetectorWorker } from './process-detector.worker';
import { Specialist31RegulationsWorker } from './specialist-3-1-regulations.worker';
import { Specialist314GoalsWorker } from './specialist-3-14-goals.worker';
import { Specialist32KnowledgeCloneWorker } from './specialist-3-2-knowledge-clone.worker';
import { Specialist33DecisionsWorker } from './specialist-3-3-decisions.worker';
import { Specialist34ProjectCustomerWorker } from './specialist-3-4-project-customer.worker';
import { Specialist35InsightsWorker } from './specialist-3-5-insights.worker';
import { Specialist36IdeasWorker } from './specialist-3-6-ideas.worker';
import { Specialist37SkillWorker } from './specialist-3-7-skill.worker';
import { SprintHelperWorker } from './sprint-helper.worker';

/**
 * Минимальный контракт хендлера специалиста: один метод `handle(job)`,
 * который выполняет логику ОДНОГО специалиста. jobName-маршрутизация на этом
 * уровне уже выполнена диспетчером — хендлеру достаются только «свои» jobs.
 */
interface SpecialistHandler {
  handle(job: Job): Promise<void>;
}

/**
 * Ф2 МТЗ «разблокировка конвейера» — диспетчер очереди `core.specialist-routing`.
 *
 * **Почему это нужно.** Раньше на одной очереди `core.specialist-routing`
 * поднималось 14 конкурирующих `new Worker(...)` (по одному в каждом
 * специалист-воркере). BullMQ отдаёт каждый job ОДНОМУ случайному воркеру из
 * конкурирующих consumer'ов, а каждый воркер делал `if (job.name !== MY_NAME)
 * return;` — silent return → job completed → ретрая нет → ~13/14 блоков молча
 * терялись.
 *
 * BullMQ НЕ поддерживает «per-jobName consumer» на общей очереди: named
 * processor реализуется ОДНИМ Worker'ом с диспетчеризацией по `job.name`
 * (Map / switch) внутри. Это и делает этот класс — единственный Worker на
 * очереди, который по `job.name` делегирует в нужный handler-Injectable.
 *
 * Неизвестный `job.name` → **throw** (а не silent return): job попадает в
 * `failed` и виден, а не теряется как «completed».
 *
 * concurrency=4 — один Worker вместо прежних 14×(1..2). Баланс throughput vs
 * LLM rate-limit на малом тенанте: специалисты внутри ходят в LLM-прокси,
 * поэтому не задираем параллелизм.
 */
@Injectable()
export class SpecialistRoutingDispatcherWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SpecialistRoutingDispatcherWorker.name);
  private worker: Worker | null = null;
  private readonly handlers = new Map<string, SpecialistHandler>();

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PipelineRunner) private readonly pipe: PipelineRunner,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist31RegulationsWorker)
    private readonly regulations: Specialist31RegulationsWorker,
    @Inject(Specialist32KnowledgeCloneWorker)
    private readonly knowledgeClone: Specialist32KnowledgeCloneWorker,
    @Inject(Specialist33DecisionsWorker)
    private readonly decisions: Specialist33DecisionsWorker,
    @Inject(Specialist34ProjectCustomerWorker)
    private readonly projectCustomer: Specialist34ProjectCustomerWorker,
    @Inject(Specialist35InsightsWorker)
    private readonly insights: Specialist35InsightsWorker,
    @Inject(Specialist36IdeasWorker)
    private readonly ideas: Specialist36IdeasWorker,
    @Inject(Specialist37SkillWorker)
    private readonly skill: Specialist37SkillWorker,
    @Inject(Specialist38HelpfulnessWorker)
    private readonly helpfulness: Specialist38HelpfulnessWorker,
    @Inject(ExperimentDetectorWorker)
    private readonly experiments: ExperimentDetectorWorker,
    @Inject(PersonalRelationBuilderWorker)
    private readonly personalRelation: PersonalRelationBuilderWorker,
    @Inject(ProcessDetectorWorker)
    private readonly processDetector: ProcessDetectorWorker,
    @Inject(RoleMapBuilderWorker)
    private readonly roleMap: RoleMapBuilderWorker,
    @Inject(Specialist314GoalsWorker)
    private readonly goals: Specialist314GoalsWorker,
    @Inject(SprintHelperWorker)
    private readonly sprintHelper: SprintHelperWorker,
  ) {}

  onModuleInit(): void {
    // Карта jobName → handler. Имена берём из static-констант каждого
    // специалиста (источник правды — RouterService.SPECIALIST.* / static
    // SPECIALIST_NAME | JOB_NAME), а не из строковых литералов.
    const register = (name: string, handler: SpecialistHandler): void => {
      if (this.handlers.has(name)) {
        throw new Error(
          `specialist-routing: дубликат jobName '${name}' в карте диспетчера`,
        );
      }
      this.handlers.set(name, handler);
    };

    register(Specialist31RegulationsWorker.SPECIALIST_NAME, this.regulations);
    register(
      Specialist32KnowledgeCloneWorker.SPECIALIST_NAME,
      this.knowledgeClone,
    );
    register(Specialist33DecisionsWorker.SPECIALIST_NAME, this.decisions);
    register(
      Specialist34ProjectCustomerWorker.SPECIALIST_NAME,
      this.projectCustomer,
    );
    register(Specialist35InsightsWorker.SPECIALIST_NAME, this.insights);
    register(Specialist36IdeasWorker.SPECIALIST_NAME, this.ideas);
    register(Specialist37SkillWorker.SPECIALIST_NAME, this.skill);
    register(Specialist38HelpfulnessWorker.SPECIALIST_NAME, this.helpfulness);
    register(ExperimentDetectorWorker.SPECIALIST_NAME, this.experiments);
    register(
      PersonalRelationBuilderWorker.SPECIALIST_NAME,
      this.personalRelation,
    );
    register(ProcessDetectorWorker.SPECIALIST_NAME, this.processDetector);
    register(RoleMapBuilderWorker.SPECIALIST_NAME, this.roleMap);
    register(Specialist314GoalsWorker.SPECIALIST_NAME, this.goals);
    register(SprintHelperWorker.JOB_NAME, this.sprintHelper);

    // РОВНО ОДИН Worker на очереди core.specialist-routing.
    this.worker = new Worker(
      CORE_QUEUE_NAMES.SPECIALIST_ROUTING,
      (job) => this.dispatch(job),
      {
        connection: this.redis.client,
        // concurrency=4: один воркер вместо 14×2; баланс throughput vs
        // LLM rate-limit на малом тенанте.
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobName: job?.name,
          blockId: job?.data?.blockId,
          cycleId: job?.data?.cycleId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'specialist-routing: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `SpecialistRoutingDispatcherWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, handlers=${this.handlers.size})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Резолвит meetingId блока: evidence -> rawEvent(sourceType='meeting').sourceExternalId.
   * null если не из встречи.
   */
  private async resolveMeetingId(
    blockId: string | undefined,
  ): Promise<string | null> {
    if (!blockId) return null;
    const ev = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId },
      select: { rawEventId: true },
    });
    if (ev.length === 0) return null;
    const raw = await this.prisma.rawEvent.findFirst({
      where: { id: { in: ev.map((e) => e.rawEventId) }, sourceType: 'meeting' },
      orderBy: { occurredAt: 'desc' }, // самая свежая встреча-источник
      select: { sourceExternalId: true },
    });
    return raw?.sourceExternalId ?? null;
  }

  /**
   * Делегирование job'а нужному специалисту по `job.name`. Неизвестный
   * jobName → throw (попадает в `failed`, виден; не теряется как completed).
   *
   * Ф0b «agent-chain-overhaul» — каждый специалист исполняется в pipeline-
   * контексте `KNOWLEDGE_GRAPH` с traceId=`mtg_<meetingId>` (если блок из
   * встречи). Это делает milestone start/done/failed и любые LogService-логи
   * внутри специалиста видимыми в трассе встречи (`diag chain --trace mtg_*`).
   * Контрол-флоу НЕ меняется: ошибка по-прежнему пробрасывается → BullMQ retry.
   */
  private async dispatch(job: Job): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      throw new Error(
        `specialist-routing: неизвестный jobName '${job.name}'`,
      );
    }
    const blockId = (job.data as { blockId?: string })?.blockId;
    // Резолв meetingId не должен ронять обработку → проглатываем ошибку.
    const meetingId = await this.resolveMeetingId(blockId).catch(() => null);
    const traceId = meetingId
      ? traceForMeeting(meetingId)
      : deriveTraceFromJob(job);
    await this.pipe.run(
      {
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: `specialist:${job.name}`,
        ...(traceId ? { traceId } : {}),
        details: { blockId, jobName: job.name },
      },
      () => handler.handle(job),
    );
  }
}
