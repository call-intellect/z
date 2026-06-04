import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type IntakeIssue } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import {
  type IntakeAutoTriageJobData,
  TRACKER_QUEUE_NAMES,
} from '../queues';
import { IssuesService } from '../services/issues.service';

/**
 * JSON Schema (strict) для ответа LLM `intake-auto-triage`.
 * Используется в `responseFormat` LlmRouter, чтобы получить
 * структурированный JSON без свободного текста.
 */
const INTAKE_AUTO_TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    suggestedProjectIdentifier: {
      type: ['string', 'null'],
      description:
        'Identifier проекта из списка (например "DEV"). null если непонятно.',
    },
    suggestedAssigneeHint: {
      type: ['string', 'null'],
      description:
        'ФИО исполнителя как написано в raw content или null. Используется для match с Person.',
    },
    suggestedGoalName: {
      type: ['string', 'null'],
      description: 'Точное имя цели из списка активных целей или null.',
    },
    suggestedPriority: {
      type: ['string', 'null'],
      enum: ['urgent', 'high', 'medium', 'low', null],
    },
    suggestedDueDate: {
      type: ['string', 'null'],
      description: 'ISO-8601 YYYY-MM-DD или null.',
    },
    suggestedLabels: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['confidence'],
} as const;

const INTAKE_AUTO_TRIAGE_SYSTEM = `Ты — AI-триаж входящих задач. По raw-тексту IntakeIssue и контексту организации определи:
- "suggestedProjectIdentifier": identifier (ABBR) проекта из списка проектов или null.
- "suggestedAssigneeHint": ФИО упомянутого исполнителя или null.
- "suggestedGoalName": название цели из активных целей или null.
- "suggestedPriority": один из "urgent" | "high" | "medium" | "low" или null.
- "suggestedDueDate": ISO-8601 (YYYY-MM-DD) или null.
- "suggestedLabels": массив меток (короткие slug'и) — может быть пустой.
- "confidence": число 0..1, насколько ты уверен что задача чётко сформулирована и атрибуция верна.

Не выдумывай. Если что-то непонятно — возвращай null. Confidence ≥ 0.92 ставь только если ВСЕ ключевые поля найдены и явно следуют из текста.`;

/**
 * Wave 3 / Tracker Phase 3 part B (2026-05-24) — IntakeAutoTriageWorker.
 *
 * Consumer `core.intake-auto-triage`. По каждому IntakeIssue:
 *   1. Skip если уже triagedAt IS NOT NULL.
 *   2. Загружает контекст организации (projects, people, goals, recent
 *      issues для паттернов).
 *   3. LLM `intake-auto-triage` → структурированный suggestion.
 *   4. Если confidence ≥ 0.92 + source='meeting' + suggestedAssigneeId
 *      разрешён через Person → создаёт Issue автоматически, помечает
 *      IntakeIssue.status='accepted', triagedAt=now, createdIssueId.
 *   5. Иначе — обновляет suggested* поля (status остаётся 'pending').
 *
 * Все шаги в одном методе `process` ради читаемости. На любую ошибку LLM —
 * job упадёт, BullMQ retry'нет (см. INTAKE_AUTO_TRIAGE_JOB_OPTIONS).
 */
@Injectable()
export class IntakeAutoTriageWorker
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Порог автоматического создания Issue. По ТЗ §3 — ≥ 0.92.
   * Вынесен в константу, чтобы один раз менять (и переиспользовать в тестах).
   */
  static readonly AUTO_ACCEPT_CONFIDENCE_THRESHOLD = 0.92;

  private readonly logger = new Logger(IntakeAutoTriageWorker.name);
  private worker: Worker<IntakeAutoTriageJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<IntakeAutoTriageJobData>(
      TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE,
      async (job) =>
        this.pipe.job(SystemLogPipeline.INTEGRATIONS, 'tracker.intake-triage', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobId: job?.id,
          intakeIssueId: job?.data?.intakeIssueId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'intake-auto-triage: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `IntakeAutoTriageWorker запущен (${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Public, чтобы тесты могли вызвать без BullMQ Worker'а (как делает
   * recognition-formulate spec).
   */
  async process(job: Job<IntakeAutoTriageJobData>): Promise<void> {
    const { tenantId, intakeIssueId } = job.data;
    const tenantTop = tenantTopOf(tenantId);

    // 1. Загружаем IntakeIssue + проверяем skip-условия.
    const intake = await this.prisma.intakeIssue.findFirst({
      where: { id: intakeIssueId, tenantId },
    });
    if (!intake) {
      this.logger.debug(
        { intakeIssueId, tenantId },
        'intake-auto-triage: IntakeIssue не найден — пропуск',
      );
      return;
    }
    if (intake.triagedAt !== null) {
      this.logger.debug(
        { intakeIssueId, status: intake.status },
        'intake-auto-triage: уже triaged — пропуск',
      );
      this.metrics?.incAiIntakeSuggested({
        tenantTop,
        status: 'skipped_already_triaged',
      });
      return;
    }

    // 2. Контекст организации.
    const [projects, people, goals, recentIssues] = await Promise.all([
      this.prisma.project.findMany({
        where: { tenantId, deletedAt: null, archivedAt: null },
        select: { id: true, identifier: true, name: true },
        take: 40,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.person.findMany({
        where: { tenantId, deletedAt: null, relationship: 'employee' },
        select: { name: true, userId: true },
        take: 80,
        orderBy: { name: 'asc' },
      }),
      this.prisma.goal.findMany({
        where: { tenantId, archivedAt: null, status: 'active' },
        select: { id: true, name: true },
        take: 30,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.issue.findMany({
        where: { tenantId, archivedAt: null },
        select: { identifier: true, title: true, priority: true },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const userMessage = this.buildUserMessage({
      intake,
      projects,
      people: people.map((p) => p.name),
      goals: goals.map((g) => g.name),
      recentIssues,
    });

    // 3. LLM-вызов.
    let parsed: TriageLlmOutput | null;
    try {
      const result = await this.llm.call({
        taskType: 'intake-auto-triage',
        tenantId,
        systemPrompt: INTAKE_AUTO_TRIAGE_SYSTEM,
        userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'intake_auto_triage',
          schema: INTAKE_AUTO_TRIAGE_SCHEMA as unknown as Record<string, unknown>,
          strict: true,
        },
        dataClass: 'internal',
        sourceRef: { type: 'intake', id: intake.id },
      });
      parsed = parseTriageOutput(result.text);
    } catch (err) {
      this.logger.warn(
        {
          intakeIssueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'intake-auto-triage: LLM упал — оставляем pending',
      );
      this.metrics?.incAiIntakeSuggested({ tenantTop, status: 'llm_error' });
      // throw нужен, чтобы BullMQ retry'нул (по политике 5 попыток).
      throw err;
    }
    if (!parsed) {
      this.logger.warn(
        { intakeIssueId },
        'intake-auto-triage: LLM вернул невалидный JSON',
      );
      this.metrics?.incAiIntakeSuggested({ tenantTop, status: 'llm_error' });
      return;
    }

    // 4. Маппинг hints → ID.
    const suggestedProjectId = resolveProjectId(
      projects,
      parsed.suggestedProjectIdentifier,
      intake.suggestedProjectId,
    );
    // ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 5.1 — для
    // intake из встречи (`source='meeting'`) исполнитель уже резолвнут
    // upstream по IDENTITY участников встречи (см.
    // `meeting-extract-actions.service.ts`), а значит `intake.suggestedAssigneeId`
    // identity-корректен. НЕ перезатираем его substring-резолвом по ВСЕМУ
    // тенанту (дубль-баг: тёзка из другого отдела). Substring-логика
    // (`resolveAssigneeUserId`) остаётся только для не-meeting источников
    // (telegram/in_app), где участников встречи нет.
    const suggestedAssigneeId =
      intake.source === 'meeting'
        ? intake.suggestedAssigneeId
        : resolveAssigneeUserId(
            people,
            parsed.suggestedAssigneeHint ?? null,
            intake.suggestedAssigneeId,
          );
    const suggestedGoalId = resolveGoalId(
      goals,
      parsed.suggestedGoalName ?? null,
      intake.suggestedGoalId,
    );
    const suggestedDueDate = parseIsoDate(parsed.suggestedDueDate ?? null);
    const suggestedPriority = parsed.suggestedPriority ?? null;
    const suggestedLabels = parsed.suggestedLabels ?? [];
    const confidence = clampConfidence(parsed.confidence ?? 0);

    // 5. Auto-create Issue или просто update suggested*.
    const canAutoAccept =
      confidence >= IntakeAutoTriageWorker.AUTO_ACCEPT_CONFIDENCE_THRESHOLD &&
      intake.source === 'meeting' &&
      suggestedAssigneeId !== null &&
      suggestedProjectId !== null;

    if (canAutoAccept) {
      await this.autoAccept({
        tenantId,
        intake,
        suggestedProjectId: suggestedProjectId!,
        suggestedAssigneeId: suggestedAssigneeId!,
        suggestedGoalId,
        suggestedPriority,
        suggestedDueDate,
        suggestedLabels,
        confidence,
      });
      this.metrics?.incAiIntakeAutoAccepted({ tenantTop });
      this.metrics?.incAiIntakeSuggested({ tenantTop, status: 'auto_accepted' });
      this.logger.log(
        {
          intakeIssueId,
          confidence,
          source: intake.source,
        },
        'intake-auto-triage: автоматически принят (создан Issue)',
      );
      return;
    }

    // 6. Fallback — обновляем suggested*. Status остаётся 'pending'.
    await this.prisma.intakeIssue.update({
      where: { id: intake.id },
      data: {
        suggestedProjectId,
        suggestedAssigneeId,
        suggestedGoalId,
        suggestedPriority,
        suggestedDueDate,
        suggestedLabels,
        confidence: new Prisma.Decimal(confidence),
      },
    });
    this.metrics?.incAiIntakeSuggested({ tenantTop, status: 'pending' });
    this.logger.log(
      {
        intakeIssueId,
        confidence,
        canAutoAccept: false,
        source: intake.source,
      },
      'intake-auto-triage: обновлены suggested*, ждём ручного триажа',
    );
  }

  /**
   * Создаёт Issue из IntakeIssue и помечает его как accepted.
   *
   * NB: НЕ внутри $transaction — Issues.create уже сам атомарен, а лишний
   * слой транзакции внутри AI-worker'а будет дольше держать lock'и БД.
   * В худшем сценарии (rare race): Issue создан, IntakeIssue обновить не
   * успели — `triagedAt IS NULL`, при retry'е воркера дубль не создастся,
   * потому что хэш externalId уже подвинут (нет, externalId не меняется —
   * этот сценарий тут реально может дать дубль; для устойчивости проверяем
   * `intake.createdIssueId IS NOT NULL` в начале process).
   */
  private async autoAccept(args: {
    tenantId: string;
    intake: IntakeIssue;
    suggestedProjectId: string;
    suggestedAssigneeId: string;
    suggestedGoalId: string | null;
    suggestedPriority:
      | 'urgent'
      | 'high'
      | 'medium'
      | 'low'
      | null;
    suggestedDueDate: Date | null;
    suggestedLabels: string[];
    confidence: number;
  }): Promise<void> {
    const { tenantId, intake } = args;
    // Гард от дубля: если createdIssueId уже есть — выходим.
    if (intake.createdIssueId) {
      this.logger.debug(
        { intakeIssueId: intake.id, createdIssueId: intake.createdIssueId },
        'intake-auto-triage: createdIssueId уже выставлен — пропуск',
      );
      return;
    }
    const title =
      intake.extractedTitle ?? intake.rawContent.slice(0, 200);
    const description =
      intake.extractedDescription ?? intake.rawContent;
    // Системный userId для «AI-action». Берём owner'а проекта, чтобы FK на
    // createdBy не упал (User.id required).
    const proj = await this.prisma.project.findUnique({
      where: { id: args.suggestedProjectId },
      select: { ownerId: true },
    });
    const systemUserId = proj?.ownerId;
    if (!systemUserId) {
      this.logger.warn(
        { intakeIssueId: intake.id, projectId: args.suggestedProjectId },
        'intake-auto-triage: не нашли ownerId проекта для createdBy — fallback на pending',
      );
      await this.prisma.intakeIssue.update({
        where: { id: intake.id },
        data: {
          suggestedProjectId: args.suggestedProjectId,
          suggestedAssigneeId: args.suggestedAssigneeId,
          suggestedGoalId: args.suggestedGoalId,
          suggestedPriority: args.suggestedPriority,
          suggestedDueDate: args.suggestedDueDate,
          suggestedLabels: args.suggestedLabels,
          confidence: new Prisma.Decimal(args.confidence),
        },
      });
      return;
    }
    const created = await this.issues.create(
      args.suggestedProjectId,
      {
        title,
        description,
        descriptionHtml: null,
        descriptionStripped: description,
        priority: args.suggestedPriority ?? 'none',
        stateId: null,
        parentId: null,
        estimatePoints: null,
        sortOrder: 0,
        startDate: null,
        dueDate: args.suggestedDueDate,
        cycleId: null,
        goalId: args.suggestedGoalId,
        assigneeUserIds: [args.suggestedAssigneeId],
        labelIds: [],
        externalSource: intake.externalSource ?? intake.source,
        externalId: intake.externalId,
      },
      tenantId,
      systemUserId,
    );
    await this.prisma.intakeIssue.update({
      where: { id: intake.id },
      data: {
        status: 'accepted',
        triagedAt: new Date(),
        createdIssueId: created.id,
        suggestedProjectId: args.suggestedProjectId,
        suggestedAssigneeId: args.suggestedAssigneeId,
        suggestedGoalId: args.suggestedGoalId,
        suggestedPriority: args.suggestedPriority,
        suggestedDueDate: args.suggestedDueDate,
        suggestedLabels: args.suggestedLabels,
        confidence: new Prisma.Decimal(args.confidence),
      },
    });
  }

  /**
   * Собирает user-сообщение для LLM. Структура: raw content + контекст
   * организации (projects / people / goals / recent issues).
   */
  private buildUserMessage(args: {
    intake: IntakeIssue;
    projects: Array<{ identifier: string; name: string }>;
    people: string[];
    goals: string[];
    recentIssues: Array<{
      identifier: string;
      title: string;
      priority: string;
    }>;
  }): string {
    const lines: string[] = [];
    lines.push('Raw content:');
    lines.push(args.intake.rawContent.slice(0, 2000));
    if (args.intake.extractedTitle) {
      lines.push('');
      lines.push(`Извлечённый title (если есть): ${args.intake.extractedTitle}`);
    }
    if (args.projects.length > 0) {
      lines.push('');
      lines.push('Проекты:');
      for (const p of args.projects) {
        lines.push(`  - ${p.identifier}: ${p.name}`);
      }
    }
    if (args.people.length > 0) {
      lines.push('');
      lines.push('Сотрудники:');
      for (const name of args.people.slice(0, 60)) {
        lines.push(`  - ${name}`);
      }
    }
    if (args.goals.length > 0) {
      lines.push('');
      lines.push('Активные цели:');
      for (const g of args.goals) {
        lines.push(`  - ${g}`);
      }
    }
    if (args.recentIssues.length > 0) {
      lines.push('');
      lines.push('Недавние задачи (для контекста меток/приоритета):');
      for (const i of args.recentIssues) {
        lines.push(`  - [${i.identifier}] ${i.title} (priority=${i.priority})`);
      }
    }
    return lines.join('\n');
  }
}

// ─────────────────── helpers (pure functions, easy to unit-test) ──────

interface TriageLlmOutput {
  suggestedProjectIdentifier?: string | null;
  suggestedAssigneeHint?: string | null;
  suggestedGoalName?: string | null;
  suggestedPriority?: 'urgent' | 'high' | 'medium' | 'low' | null;
  suggestedDueDate?: string | null;
  suggestedLabels?: string[];
  confidence?: number;
}

function parseTriageOutput(text: string): TriageLlmOutput | null {
  try {
    const j = JSON.parse(text);
    if (typeof j !== 'object' || j === null) return null;
    return j as TriageLlmOutput;
  } catch {
    return null;
  }
}

function resolveProjectId(
  projects: Array<{ id: string; identifier: string }>,
  hint: string | null | undefined,
  fallback: string | null,
): string | null {
  if (hint && hint.trim()) {
    const norm = hint.trim().toLowerCase();
    const found = projects.find(
      (p) => p.identifier.toLowerCase() === norm,
    );
    if (found) return found.id;
  }
  return fallback;
}

function resolveAssigneeUserId(
  people: Array<{ name: string; userId: string | null }>,
  hint: string | null | undefined,
  fallback: string | null,
): string | null {
  if (!hint || !hint.trim()) return fallback;
  const trimmed = hint.trim().toLowerCase();
  // Exact match (case-insensitive).
  let found = people.find((p) => p.name.toLowerCase() === trimmed);
  if (!found) {
    // Substring match — берём первого, если ровно один результат.
    const first = trimmed.split(/\s+/)[0] ?? '';
    if (first.length >= 2) {
      const matches = people.filter((p) =>
        p.name.toLowerCase().includes(first),
      );
      if (matches.length === 1) {
        found = matches[0];
      }
    }
  }
  return found?.userId ?? fallback;
}

function resolveGoalId(
  goals: Array<{ id: string; name: string }>,
  hint: string | null | undefined,
  fallback: string | null,
): string | null {
  if (!hint || !hint.trim()) return fallback;
  const norm = hint.trim().toLowerCase();
  const found = goals.find((g) => g.name.toLowerCase() === norm);
  return found?.id ?? fallback;
}

function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return Math.round(v * 1000) / 1000;
}
