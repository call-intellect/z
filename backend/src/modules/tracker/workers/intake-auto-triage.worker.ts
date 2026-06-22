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

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { type IntakeAutoTriageJobData, TRACKER_QUEUE_NAMES } from '../queues';
import { linkDerivedDecisionsForIssue } from '../services/decision-task-link.util';
import { IssuesService } from '../services/issues.service';
import { ProjectsService } from '../services/projects.service';

const INBOX_PROJECT_NAME = 'Входящие';
const MEETING_PROJECT_NAME = 'Из встреч';

const ASSIGNEE_UNRESOLVED_NOTE = '⚠️ Кора: не удалось определить исполнителя — уточните';

const INTAKE_AUTO_TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    suggestedProjectIdentifier: {
      type: ['string', 'null'],
      description: 'Identifier проекта из списка (например "DEV"). null если непонятно.',
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

Не выдумывай. Если что-то непонятно — возвращай null. Confidence ≥ 0.75 ставь только если ВСЕ ключевые поля найдены и явно следуют из текста (это порог авто-создания задачи).`;

@Injectable()
export class IntakeAutoTriageWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntakeAutoTriageWorker.name);
  private worker: Worker<IntakeAutoTriageJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
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
    this.logger.debug(`IntakeAutoTriageWorker запущен (${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<IntakeAutoTriageJobData>): Promise<void> {
    const { tenantId, intakeIssueId } = job.data;
    const tenantTop = tenantTopOf(tenantId);

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
        source: intake.source,
      });
      return;
    }

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

    const rawUserMessage = this.buildUserMessage({
      intake,
      projects,
      people: people.map((p) => p.name),
      goals: goals.map((g) => g.name),
      recentIssues,
    });

    const guardOn = this.isPromptInjectionGuardEnabled();
    if (guardOn) {
      const sanitized = sanitizeCustomPrompt(intake.rawContent);
      for (const pattern of sanitized.reasons) {
        this.metrics?.incPromptInjectionAttempt({ source: 'chat', pattern });
      }
    }
    const systemPrompt = guardOn
      ? withInjectionGuard(INTAKE_AUTO_TRIAGE_SYSTEM)
      : INTAKE_AUTO_TRIAGE_SYSTEM;
    const userMessage = guardOn ? wrapUserData(rawUserMessage) : rawUserMessage;

    let parsed: TriageLlmOutput | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.llm.call({
          taskType: 'intake-auto-triage',
          tenantId,
          systemPrompt,
          userMessage,
          responseFormat: {
            type: 'json_schema',
            name: 'intake_auto_triage',
            schema: INTAKE_AUTO_TRIAGE_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
          dataClass: 'internal',
          sourceRef: { type: 'intake', id: intake.id },
          validate: (text) => parseTriageOutput(text) !== null,
        });
        lastErr = null;
        parsed = parseTriageOutput(result.text);
        if (parsed) break;
        this.logger.warn(
          { intakeIssueId, attempt },
          'intake-auto-triage: невалидный JSON LLM — повтор',
        );
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          { intakeIssueId, attempt, err: err instanceof Error ? err.message : String(err) },
          'intake-auto-triage: LLM упал — повтор',
        );
      }
    }
    if (!parsed) {
      this.metrics?.incAiIntakeSuggested({
        tenantTop,
        status: 'llm_error',
        source: intake.source,
      });
      if (lastErr) {
        throw lastErr;
      }
      this.logger.warn(
        { intakeIssueId },
        'intake-auto-triage: LLM вернул невалидный JSON (2 попытки) — оставляем pending',
      );
      return;
    }

    const suggestedProjectId = resolveProjectId(
      projects,
      parsed.suggestedProjectIdentifier,
      intake.suggestedProjectId,
    );
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

    const confidentEnough = confidence >= this.cfg.tracker.autoAcceptConfidenceThreshold;
    const isMeeting = intake.source === 'meeting';
    const meetingAlwaysPromote = this.cfg.tracker.meetingTasksAlwaysPromote;
    const meetingPromote = isMeeting && meetingAlwaysPromote;

    let effectiveAssigneeId = suggestedAssigneeId;
    let assigneeUnresolved = false;
    if (confidentEnough && effectiveAssigneeId === null && intake.source !== 'meeting') {
      const orgOwnerId = await this.resolveOrgOwnerId(tenantId);
      if (orgOwnerId) {
        effectiveAssigneeId = orgOwnerId;
        assigneeUnresolved = true;
      }
    }

    let effectiveProjectId = suggestedProjectId;
    let viaDefaultProject = false;
    if (
      effectiveProjectId === null &&
      (meetingPromote || (confidentEnough && effectiveAssigneeId !== null))
    ) {
      effectiveProjectId = meetingPromote
        ? await this.resolveMeetingProjectId(tenantId)
        : await this.resolveInboxProjectId(tenantId);
      viaDefaultProject = effectiveProjectId !== null;
    }

    // TZ task-dedup (2026-06-16, Ф1 уровень A) — если дедуп-арбитр на создании
    // пометил карточку дублем (suggestedDuplicateOfIssueId), НЕ принимаем
    // автоматически: route to human (человек сам сливает через triage
    // decision='duplicate'). Авто-merge ЗАПРЕЩЁН (R2/R13).
    // Boolean(): поле nullable; в БД дефолт null, но защищаемся и от undefined
    // (иначе `!== null` ложно срабатывает на отсутствующем поле → блок авто-приёма).
    const hasSuggestedDuplicate = Boolean(intake.suggestedDuplicateOfIssueId);
    let autoAcceptSources: string[];
    try {
      const raw = await this.cfg.getDynamic<string[]>('intake.autoAcceptSources', undefined, []);
      autoAcceptSources = Array.isArray(raw) ? raw : [];
    } catch {
      autoAcceptSources = [];
    }
    const sourceAllowed =
      autoAcceptSources.length === 0 || autoAcceptSources.includes(intake.source);
    const canAutoAccept = meetingPromote
      ? effectiveProjectId !== null && !hasSuggestedDuplicate && sourceAllowed
      : confidentEnough &&
        effectiveAssigneeId !== null &&
        effectiveProjectId !== null &&
        !hasSuggestedDuplicate &&
        sourceAllowed;
    if ((confidentEnough || meetingPromote) && !sourceAllowed) {
      this.logger.log(
        { intakeIssueId, source: intake.source },
        'intake-auto-triage: источник не в intake.autoAcceptSources — авто-приём отключён, ждём человека',
      );
    }
    if (hasSuggestedDuplicate) {
      this.logger.log(
        {
          intakeIssueId,
          suggestedDuplicateOfIssueId: intake.suggestedDuplicateOfIssueId,
        },
        'intake-auto-triage: найден дубль — авто-приём заблокирован, ждём человека',
      );
    }

    if (canAutoAccept) {
      await this.autoAccept({
        tenantId,
        intake,
        suggestedProjectId: effectiveProjectId!,
        suggestedAssigneeId: effectiveAssigneeId,
        suggestedGoalId,
        suggestedPriority,
        suggestedDueDate,
        suggestedLabels,
        confidence,
        appendAssigneeNote: assigneeUnresolved,
      });
      this.metrics?.incAiIntakeAutoAccepted({
        tenantTop,
        source: intake.source,
        viaDefaultProject: viaDefaultProject ? 'true' : 'false',
      });
      this.metrics?.incAiIntakeSuggested({
        tenantTop,
        status: 'auto_accepted',
        source: intake.source,
      });
      this.logger.debug(
        {
          intakeIssueId,
          confidence,
          source: intake.source,
        },
        'intake-auto-triage: автоматически принят (создан Issue)',
      );
      return;
    }

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
    this.metrics?.incAiIntakeSuggested({
      tenantTop,
      status: 'pending',
      source: intake.source,
    });
    this.logger.debug(
      {
        intakeIssueId,
        confidence,
        canAutoAccept: false,
        source: intake.source,
      },
      'intake-auto-triage: обновлены suggested*, ждём ручного триажа',
    );
  }

  private async autoAccept(args: {
    tenantId: string;
    intake: IntakeIssue;
    suggestedProjectId: string;
    suggestedAssigneeId: string | null;
    suggestedGoalId: string | null;
    suggestedPriority: 'urgent' | 'high' | 'medium' | 'low' | null;
    suggestedDueDate: Date | null;
    suggestedLabels: string[];
    confidence: number;
    appendAssigneeNote: boolean;
  }): Promise<void> {
    const { tenantId, intake } = args;
    if (intake.createdIssueId) {
      this.logger.debug(
        { intakeIssueId: intake.id, createdIssueId: intake.createdIssueId },
        'intake-auto-triage: createdIssueId уже выставлен — пропуск',
      );
      return;
    }
    const title = intake.extractedTitle ?? intake.rawContent.slice(0, 200);
    const baseDescription = intake.extractedDescription ?? intake.rawContent;
    const description = args.appendAssigneeNote
      ? `${baseDescription}\n\n${ASSIGNEE_UNRESOLVED_NOTE}`
      : baseDescription;
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
        assigneeUserIds: args.suggestedAssigneeId ? [args.suggestedAssigneeId] : [],
        labelIds: [],
        externalSource: intake.externalSource ?? intake.source,
        externalId: intake.externalId,
        sourceBlockIds: intake.sourceBlockIds,
        linkedMeetingIds: intake.meetingId ? [intake.meetingId] : [],
        // TZ task-dedup (2026-06-16) — дедуп уже отработал на уровне A
        // (intake create); двойной suggest не нужен.
        skipDedup: true,
      },
      tenantId,
      systemUserId,
    );
    try {
      const links = await linkDerivedDecisionsForIssue(this.prisma, {
        tenantId,
        issueId: created.id,
        sourceBlockIds: intake.sourceBlockIds,
      });
      if (links > 0) {
        this.logger.debug(
          { intakeIssueId: intake.id, issueId: created.id, links },
          'intake-auto-triage: создано DecisionTaskLink(derived)',
        );
      }
    } catch (e) {
      this.logger.warn(
        {
          intakeIssueId: intake.id,
          issueId: created.id,
          err: e instanceof Error ? e.message : String(e),
        },
        'intake-auto-triage: линковка derived-решений упала (best-effort)',
      );
    }
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

  private async resolveOrgOwnerId(tenantId: string): Promise<string | null> {
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    return org?.ownerId ?? null;
  }

  private async resolveInboxProjectId(tenantId: string): Promise<string | null> {
    const findExisting = (): Promise<{ id: string } | null> =>
      this.prisma.project.findFirst({
        where: {
          tenantId,
          name: INBOX_PROJECT_NAME,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    const existing = await findExisting();
    if (existing) return existing.id;
    const ownerId = await this.resolveOrgOwnerId(tenantId);
    if (!ownerId) {
      this.logger.warn(
        { tenantId },
        'intake-auto-triage: не нашли владельца Org — проект «Входящие» не создан',
      );
      return null;
    }
    try {
      const created = await this.projects.create(
        {
          name: INBOX_PROJECT_NAME,
          description:
            'Задачи из внешних каналов без определённого проекта. Создан Корой автоматически (авто-приём входящих).',
          network: 0,
          timezone: 'Europe/Moscow',
          cycleViewEnabled: true,
          intakeViewEnabled: true,
          gantViewEnabled: false,
          timeTrackingEnabled: false,
        },
        tenantId,
        ownerId,
      );
      return created.id;
    } catch (err) {
      const retry = await findExisting();
      if (retry) return retry.id;
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'intake-auto-triage: создание проекта «Входящие» упало — оставляем pending',
      );
      return null;
    }
  }

  private async resolveMeetingProjectId(tenantId: string): Promise<string | null> {
    const findExisting = (): Promise<{ id: string } | null> =>
      this.prisma.project.findFirst({
        where: {
          tenantId,
          name: MEETING_PROJECT_NAME,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    const existing = await findExisting();
    if (existing) return existing.id;
    const ownerId = await this.resolveOrgOwnerId(tenantId);
    if (!ownerId) {
      this.logger.warn(
        { tenantId },
        'intake-auto-triage: не нашли владельца Org — проект «Из встреч» не создан, fallback на «Входящие»',
      );
      return this.resolveInboxProjectId(tenantId);
    }
    try {
      const created = await this.projects.create(
        {
          name: MEETING_PROJECT_NAME,
          description: 'Задачи, поставленные на встречах. Создан Корой автоматически.',
          network: 0,
          timezone: 'Europe/Moscow',
          cycleViewEnabled: true,
          intakeViewEnabled: true,
          gantViewEnabled: false,
          timeTrackingEnabled: false,
        },
        tenantId,
        ownerId,
      );
      return created.id;
    } catch (err) {
      const retry = await findExisting();
      if (retry) return retry.id;
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'intake-auto-triage: создание проекта «Из встреч» упало — fallback на «Входящие»',
      );
      return this.resolveInboxProjectId(tenantId);
    }
  }

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

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
  const raw = tryParseJson(text);
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if ('raw' in o && Object.keys(o).length === 1 && typeof o.raw === 'string') {
    return null;
  }
  return o as TriageLlmOutput;
}

function resolveProjectId(
  projects: Array<{ id: string; identifier: string }>,
  hint: string | null | undefined,
  fallback: string | null,
): string | null {
  if (hint && hint.trim()) {
    const norm = hint.trim().toLowerCase();
    const found = projects.find((p) => p.identifier.toLowerCase() === norm);
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
  let found = people.find((p) => p.name.toLowerCase() === trimmed);
  if (!found) {
    const first = trimmed.split(/\s+/)[0] ?? '';
    if (first.length >= 2) {
      const matches = people.filter((p) => p.name.toLowerCase().includes(first));
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
