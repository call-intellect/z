import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  withNotATaskDiscriminator,
  wrapUserData,
} from '../../../ai/services/prompts/common';
import { computeExpiresAt } from '../../../pending-actions/expires-at.util';
import { shouldMaterializeTask } from '../../../tracker/services/task-quality-gate.util';

/** Code-fallback TTL (дни) intake, когда TypedConfigService недоступен (@Optional). */
const INTAKE_TTL_DAYS_FALLBACK = 30;

/**
 * Wave 3 / Tracker Phase 4 РФ (2026-05-24) — TelegramTaskParserService.
 *
 * Главный LLM-уровень Telegram-бота для задач. 4 метода:
 *
 *   1. `parseCreateTask`     — пользователь пишет боту в личке текст/voice.
 *      LLM `telegram-create-task` извлекает title + suggestedAssigneeHint +
 *      suggestedDueDate + suggestedProjectHint + confidence + sourceQuote.
 *      Создаёт IntakeIssue(source='telegram'); при confidence ≥ 0.85 енкью
 *      auto-triage (Tracker Phase 3 part B).
 *
 *   2. `parseForwardToTask`  — forward стороннего сообщения боту. То же
 *      извлечение, но source='telegram_forward', rawContent = forwarded text.
 *
 *   3. `classifyReply`       — пользователь reply на bot-уведомление:
 *      LLM `telegram-reply-classify` → status_command | comment | new_task.
 *      Status_command распознаёт «принял» / «+1 день» / «не сделаю» →
 *      возвращает действие. Comment → текст. New_task → новый IntakeIssue.
 *
 *   4. `formulateDigest`     — для утреннего cron'а: на входе агрегат
 *      issues, на выходе тёплый markdown-дайджест.
 *
 * Все методы — best-effort. На любую ошибку LLM возвращают «пустой» результат
 * (без throw): caller'у — null/[]/'неизвестный'. Это нужно, чтобы flow
 * Telegram-бота никогда не падал из-за нашего LLM.
 *
 * Зависимости:
 *   - LlmRouterService — обязательная (@Global AiModule).
 *   - PrismaService    — для context lookup (projects/people/issues).
 *
 * Tracker-зависимости (IntakeService / IntakeAutoTriageQueueService) —
 * @Optional(), потому что ConversationalModule по умолчанию НЕ импортирует
 * TrackerModule. См. README на регистрацию в `conversational.module.ts`.
 */
@Injectable()
export class TelegramTaskParserService {
  private readonly logger = new Logger(TelegramTaskParserService.name);

  /** Порог auto-create: при confidence ≥ 0.85 енкью auto-triage сразу. */
  static readonly AUTO_TRIAGE_THRESHOLD = 0.85;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    /**
     * E2 (мастер-ТЗ Волна 1, Кластер A) — нужен только для kill-switch
     * анти-инъекционной обёртки (`promptInjectionGuardEnabled`). `@Optional()`
     * + дефолт null — существующие unit-тесты конструируют сервис без него.
     * Default поведение при отсутствии cfg — guard ON (см.
     * `isPromptInjectionGuardEnabled`).
     */
    @Optional()
    @Inject(TypedConfigService)
    private readonly config: TypedConfigService | null = null,
  ) {}

  /**
   * E2 — мастер-флаг защиты от prompt-injection. Telegram-форвард (чужое
   * сообщение) и личное сообщение боту идут в LLM как user-данные и обязаны
   * быть обёрнуты в маркеры. Default — true (как в env.schema); при
   * отсутствии cfg (старые unit-тесты) тоже true.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.config?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  // ─────────────────────────── 1. parseCreateTask ────────────────────────

  async parseCreateTask(args: {
    tenantId: string;
    userId: string;
    rawText: string;
    /** External id для идемпотентности (e.g. `${chatId}:${messageId}`). */
    externalId?: string | null;
  }): Promise<TelegramTaskParseResult> {
    const rawText = (args.rawText ?? '').trim();
    if (!rawText) {
      return {
        intakeIssueId: null,
        autoTriageEnqueued: false,
        confidence: null,
        suggested: null,
        reason: 'empty_text',
      };
    }
    const ctx = await this.loadOrgContext(args.tenantId, args.userId);
    const today = new Date().toISOString().slice(0, 10);
    const prompt = this.buildTaskExtractPrompt({
      mode: 'own',
      text: rawText,
      today,
      ctx,
    });

    const parsed = await this.callTaskExtract({
      tenantId: args.tenantId,
      userId: args.userId,
      systemPrompt: prompt.system,
      userMessage: prompt.user,
      taskType: 'telegram-create-task',
    });
    if (!parsed) {
      return {
        intakeIssueId: null,
        autoTriageEnqueued: false,
        confidence: null,
        suggested: null,
        reason: 'llm_failed',
      };
    }
    return this.createIntakeFromParsed({
      tenantId: args.tenantId,
      source: 'telegram',
      rawText,
      externalId: args.externalId ?? null,
      parsed,
    });
  }

  // ─────────────────────────── 2. parseForwardToTask ─────────────────────

  async parseForwardToTask(args: {
    tenantId: string;
    userId: string;
    forwardedText: string;
    externalId?: string | null;
  }): Promise<TelegramTaskParseResult> {
    const rawText = (args.forwardedText ?? '').trim();
    if (!rawText) {
      return {
        intakeIssueId: null,
        autoTriageEnqueued: false,
        confidence: null,
        suggested: null,
        reason: 'empty_text',
      };
    }
    const ctx = await this.loadOrgContext(args.tenantId, args.userId);
    const today = new Date().toISOString().slice(0, 10);
    const prompt = this.buildTaskExtractPrompt({
      mode: 'forward',
      text: rawText,
      today,
      ctx,
    });
    const parsed = await this.callTaskExtract({
      tenantId: args.tenantId,
      userId: args.userId,
      systemPrompt: prompt.system,
      userMessage: prompt.user,
      taskType: 'telegram-forward-to-task',
    });
    if (!parsed) {
      return {
        intakeIssueId: null,
        autoTriageEnqueued: false,
        confidence: null,
        suggested: null,
        reason: 'llm_failed',
      };
    }
    return this.createIntakeFromParsed({
      tenantId: args.tenantId,
      source: 'telegram_forward',
      rawText,
      externalId: args.externalId ?? null,
      parsed,
    });
  }

  // ─────────────────────────── 3. classifyReply ──────────────────────────

  async classifyReply(args: {
    tenantId: string;
    userId: string;
    replyText: string;
    relatedIssueId: string | null;
  }): Promise<TelegramReplyClassification> {
    const text = (args.replyText ?? '').trim();
    if (!text) {
      return { kind: 'unknown' };
    }
    const prompt = this.buildReplyClassifyPrompt(text);
    let result;
    try {
      result = await this.llm.call({
        taskType: 'telegram-reply-classify',
        tenantId: args.tenantId,
        userId: args.userId,
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        responseFormat: {
          type: 'json_schema',
          name: 'telegram_reply_classify',
          schema: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['status_command', 'comment', 'new_task'],
              },
              statusAction: {
                type: ['string', 'null'],
                enum: ['accept', 'postpone_one_day', 'cancel', null],
                description:
                  'Только при kind=status_command. accept = «принял/в работу», postpone_one_day = «+1 день/завтра», cancel = «не сделаю/отмена».',
              },
              commentText: {
                type: ['string', 'null'],
                description:
                  'Только при kind=comment. Очищенный текст комментария (можно с лёгким исправлением орфографии).',
              },
            },
            required: ['kind'],
          },
          strict: true,
        },
        dataClass: 'internal',
        sourceRef: args.relatedIssueId
          ? { type: 'issue', id: args.relatedIssueId }
          : null,
      });
    } catch (err) {
      this.logger.warn(
        {
          relatedIssueId: args.relatedIssueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-reply-classify: LLM упал — fallback на эвристику',
      );
      return this.heuristicReplyClassify(text);
    }
    try {
      const json = JSON.parse(result.text) as {
        kind?: 'status_command' | 'comment' | 'new_task';
        statusAction?: 'accept' | 'postpone_one_day' | 'cancel' | null;
        commentText?: string | null;
      };
      if (json.kind === 'status_command' && json.statusAction) {
        return { kind: 'status_command', action: json.statusAction };
      }
      if (json.kind === 'comment') {
        return {
          kind: 'comment',
          text: (json.commentText ?? text).trim() || text,
        };
      }
      if (json.kind === 'new_task') {
        return { kind: 'new_task', text };
      }
      return this.heuristicReplyClassify(text);
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          preview: result.text.slice(0, 200),
        },
        'telegram-reply-classify: невалидный JSON — fallback на эвристику',
      );
      return this.heuristicReplyClassify(text);
    }
  }

  // ─────────────────────────── 4. formulateDigest ────────────────────────

  async formulateDigest(args: {
    tenantId: string;
    userId: string;
    issuesPayload: TelegramDigestPayload;
  }): Promise<string | null> {
    const total =
      args.issuesPayload.urgentToday.length +
      args.issuesPayload.inProgress.length +
      args.issuesPayload.overdue.length;
    if (total === 0) return null;

    const prompt = this.buildDigestPrompt(args.issuesPayload);
    try {
      const result = await this.llm.call({
        taskType: 'telegram-digest-formulate',
        tenantId: args.tenantId,
        userId: args.userId,
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        dataClass: 'internal',
        maxTokens: 1500,
      });
      const text = (result.text ?? '').trim();
      if (!text) return this.renderDigestFallback(args.issuesPayload);
      return text;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-digest-formulate: LLM упал — отдадим fallback-markdown',
      );
      return this.renderDigestFallback(args.issuesPayload);
    }
  }

  // ─────────────────────────── helpers: LLM call ─────────────────────────

  /**
   * Единый JSON-schema вызов для create/forward — оба возвращают одну
   * структуру `ParsedTask`. Возвращает null при любой ошибке (best-effort).
   */
  private async callTaskExtract(args: {
    tenantId: string;
    userId: string;
    systemPrompt: string;
    userMessage: string;
    taskType: 'telegram-create-task' | 'telegram-forward-to-task';
  }): Promise<ParsedTask | null> {
    // E2 (мастер-ТЗ Волна 1, Кластер A) — анти-инъекционная обёртка. И личное
    // сообщение боту (telegram-create-task), и чужой форвард
    // (telegram-forward-to-task) — внешний ввод, который через auto-triage
    // может создать реальную задачу. Оборачиваем user в маркеры данных,
    // system дополняем INJECTION_GUARD_NOTE. Тройные кавычки в промптах —
    // косметика, не защита.
    const guardOn = this.isPromptInjectionGuardEnabled();
    const systemPrompt = guardOn
      ? withInjectionGuard(args.systemPrompt)
      : args.systemPrompt;
    const userMessage = guardOn
      ? wrapUserData(args.userMessage)
      : args.userMessage;
    try {
      const result = await this.llm.call({
        taskType: args.taskType,
        tenantId: args.tenantId,
        userId: args.userId,
        systemPrompt,
        userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'telegram_task_extract',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              suggestedAssigneeHint: { type: ['string', 'null'] },
              suggestedDueDate: {
                type: ['string', 'null'],
                description: 'ISO YYYY-MM-DD или YYYY-MM-DDTHH:mm:ss или null.',
              },
              suggestedProjectHint: { type: ['string', 'null'] },
              suggestedPriority: {
                type: ['string', 'null'],
                enum: ['urgent', 'high', 'medium', 'low', null],
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              sourceQuote: { type: ['string', 'null'] },
            },
            required: ['title', 'confidence'],
          },
          strict: true,
        },
        dataClass: 'internal',
      });
      const json = JSON.parse(result.text) as Partial<ParsedTask> & {
        title?: string;
        confidence?: number;
      };
      if (
        !json ||
        typeof json.title !== 'string' ||
        json.title.trim().length === 0
      ) {
        return null;
      }
      const confidence =
        typeof json.confidence === 'number'
          ? clampConfidence(json.confidence)
          : 0;
      return {
        title: json.title.trim(),
        suggestedAssigneeHint: json.suggestedAssigneeHint ?? null,
        suggestedDueDate: json.suggestedDueDate ?? null,
        suggestedProjectHint: json.suggestedProjectHint ?? null,
        suggestedPriority: json.suggestedPriority ?? null,
        confidence,
        sourceQuote: json.sourceQuote ?? null,
      };
    } catch (err) {
      this.logger.warn(
        {
          taskType: args.taskType,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-task-parser: LLM extract упал — best-effort null',
      );
      return null;
    }
  }

  // ─────────────────────────── helpers: intake create ────────────────────

  /**
   * Маппит ParsedTask → IntakeIssue + резолвит hint'ы в id'ы (person/project)
   * через простой substring-match. Возвращает структурированный результат с
   * `autoTriageEnqueued=true` если confidence ≥ AUTO_TRIAGE_THRESHOLD —
   * сам enqueue делает caller через IntakeAutoTriageQueueService (или сам
   * IntakeService.create при наличии очереди в DI).
   */
  private async createIntakeFromParsed(args: {
    tenantId: string;
    source: 'telegram' | 'telegram_forward';
    rawText: string;
    externalId: string | null;
    parsed: ParsedTask;
  }): Promise<TelegramTaskParseResult> {
    const { tenantId, source, parsed } = args;

    const suggestedAssigneeId = await this.resolveAssigneeId(
      tenantId,
      parsed.suggestedAssigneeHint,
    );
    const suggestedProjectId = await this.resolveProjectId(
      tenantId,
      parsed.suggestedProjectHint,
    );
    const suggestedDueDate = parseIsoDate(parsed.suggestedDueDate);
    const confidence = clampConfidence(parsed.confidence ?? 0);

    // Ф0 (ТЗ 2026-06-16) — детерминированный гейт качества ПЕРЕД созданием
    // задачи из AI-источника (Telegram): не материализуем «мусор» (вопрос /
    // намерение без ответственного и срока). Чистые правила, без LLM. При
    // сомнении — не создаём IntakeIssue (поток бота не падает).
    const gate = shouldMaterializeTask({
      title: parsed.title,
      ownerUserId: suggestedAssigneeId,
      ownerHint: parsed.suggestedAssigneeHint,
      dueDate: suggestedDueDate,
      source,
    });
    if (!gate.ok) {
      this.logger.log(
        { tenantId, source, reason: gate.reason, title: parsed.title },
        'telegram-task-parser: гейт качества не пропустил задачу',
      );
      return {
        intakeIssueId: null,
        autoTriageEnqueued: false,
        confidence,
        suggested: null,
        reason: 'quality_gate_rejected',
      };
    }

    let intakeIssueId: string | null;
    try {
      const created = await this.prisma.intakeIssue.create({
        data: {
          tenantId,
          projectId: suggestedProjectId,
          status: 'pending',
          source,
          externalSource: source,
          externalId: args.externalId,
          rawContent: args.rawText,
          extractedTitle: parsed.title.slice(0, 200),
          extractedDescription: parsed.sourceQuote ?? null,
          suggestedProjectId,
          suggestedAssigneeId,
          suggestedGoalId: null,
          suggestedPriority: parsed.suggestedPriority ?? null,
          suggestedDueDate,
          suggestedLabels: [],
          confidence: new Prisma.Decimal(confidence),
          // Редизайн Ф4 (2026-06-13) — авто-протухание: sweep-крон закроет
          // pending-intake после TTL (cfg.pendingActions.intakeTtlDays).
          // config @Optional → fallback 30 дней. TODO: крутилка в AdminSetting.
          expiresAt: computeExpiresAt(
            this.config?.pendingActions.intakeTtlDays ??
              INTAKE_TTL_DAYS_FALLBACK,
          ),
        },
        select: { id: true },
      });
      intakeIssueId = created.id;
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          source,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-task-parser: создание IntakeIssue упало',
      );
      return {
        intakeIssueId: null,
        autoTriageEnqueued: false,
        confidence,
        suggested: null,
        reason: 'intake_create_failed',
      };
    }

    const autoTriageEligible =
      confidence >= TelegramTaskParserService.AUTO_TRIAGE_THRESHOLD;

    return {
      intakeIssueId,
      autoTriageEnqueued: autoTriageEligible,
      confidence,
      suggested: {
        title: parsed.title,
        suggestedAssigneeId,
        suggestedProjectId,
        suggestedDueDate: suggestedDueDate?.toISOString() ?? null,
        suggestedPriority: parsed.suggestedPriority ?? null,
      },
      reason: 'ok',
    };
  }

  // ─────────────────────────── helpers: resolve hints ────────────────────

  /**
   * Substring-match: ищем Person в org по части ФИО (первое слово hint'а).
   * При множественном совпадении — null (нужен ручной триаж).
   * Возвращаем User.id (а не Person.id), потому что Issue.assigneeUserIds — это User.id.
   */
  private async resolveAssigneeId(
    tenantId: string,
    hint: string | null | undefined,
  ): Promise<string | null> {
    const trimmed = (hint ?? '').trim();
    if (trimmed.length < 2) return null;
    const firstToken = trimmed.split(/\s+/)[0] ?? '';
    if (firstToken.length < 2) return null;
    try {
      const candidates = await this.prisma.person.findMany({
        where: {
          tenantId,
          deletedAt: null,
          name: { contains: firstToken, mode: 'insensitive' },
        },
        take: 5,
        select: { userId: true, name: true },
      });
      if (candidates.length === 0) return null;
      const exact =
        candidates.find(
          (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
        ) ?? null;
      const single =
        candidates.length === 1 ? candidates[0] : exact ?? null;
      return single?.userId ?? null;
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-task-parser: resolveAssigneeId — DB error, fallback null',
      );
      return null;
    }
  }

  /**
   * Резолв Project'а по identifier'у или по подстроке имени.
   */
  private async resolveProjectId(
    tenantId: string,
    hint: string | null | undefined,
  ): Promise<string | null> {
    const trimmed = (hint ?? '').trim();
    if (trimmed.length < 2) return null;
    try {
      // 1. По identifier (точное, case-insensitive).
      const byIdent = await this.prisma.project.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          archivedAt: null,
          identifier: { equals: trimmed, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (byIdent) return byIdent.id;
      // 2. По name (substring, case-insensitive). Если ≥ 2 кандидата — null.
      const byName = await this.prisma.project.findMany({
        where: {
          tenantId,
          deletedAt: null,
          archivedAt: null,
          name: { contains: trimmed, mode: 'insensitive' },
        },
        take: 3,
        select: { id: true },
      });
      if (byName.length === 1) return byName[0]?.id ?? null;
      return null;
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-task-parser: resolveProjectId — DB error, fallback null',
      );
      return null;
    }
  }

  // ─────────────────────────── helpers: context ──────────────────────────

  /**
   * Контекст организации для LLM: последние активные проекты + сотрудники.
   * Limited — top 20 каждой категории, чтобы не раздуть промпт.
   */
  private async loadOrgContext(
    tenantId: string,
    _userId: string,
  ): Promise<OrgContext> {
    try {
      const [projects, people] = await Promise.all([
        this.prisma.project.findMany({
          where: { tenantId, deletedAt: null, archivedAt: null },
          select: { identifier: true, name: true },
          take: 20,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.person.findMany({
          where: { tenantId, deletedAt: null, relationship: 'employee' },
          select: { name: true },
          take: 30,
          orderBy: { name: 'asc' },
        }),
      ]);
      return {
        projects: projects.map((p) => ({
          identifier: p.identifier,
          name: p.name,
        })),
        people: people.map((p) => p.name),
      };
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-task-parser: loadOrgContext — DB error, пустой контекст',
      );
      return { projects: [], people: [] };
    }
  }

  // ─────────────────────────── prompts ───────────────────────────────────

  /**
   * Волна 5 / кластер B — ЕДИНЫЙ builder извлечения задачи из Telegram.
   *
   * Раньше было два почти одинаковых билдера (`buildCreateTaskPrompt` /
   * `buildForwardTaskPrompt`). Объединены в один с параметром `mode`:
   *   - mode='own'     — пользователь пишет боту в личке (создание задачи себе/коллеге);
   *   - mode='forward' — пользователь переслал боту чужое сообщение (форвард→задача).
   *
   * Общий SYSTEM-костяк (роль + список полей + правило «не выдумывай») —
   * стабилен между mode и не содержит переменных данных (cache-friendly, F1):
   * `today` ушёл из SYSTEM в user-блок «Сегодня: …». В SYSTEM остаётся лишь
   * короткая mode-специфичная вставка про источник и калибровку confidence.
   */
  private buildTaskExtractPrompt(args: {
    mode: 'own' | 'forward';
    text: string;
    today: string;
    ctx: OrgContext;
  }): { system: string; user: string } {
    // Ветка по mode — только в части про источник и калибровку confidence.
    const sourceLine =
      args.mode === 'forward'
        ? 'Пользователь переслал боту чужое сообщение (форвард из чата). Это значит «я хочу превратить это в задачу». Извлеки из форварда:'
        : 'Пользователь пишет в личке короткое поручение (себе или коллеге). Извлеки из текста:';
    const titleLine =
      args.mode === 'forward'
        ? '- "title": короткая суть, что нужно сделать. Если форвард — длинное обсуждение, выбери главное действие.'
        : '- "title": короткая формулировка задачи (5-10 слов, императив или infinitive).';
    const assigneeLine =
      args.mode === 'forward'
        ? '- "suggestedAssigneeHint": ФИО, если кто-то упомянут как ответственный; иначе null.'
        : '- "suggestedAssigneeHint": ФИО исполнителя как написано в тексте, или null если про себя / не указано.';
    const confidenceLine =
      args.mode === 'forward'
        ? '- "confidence": 0..1. Форварды часто шумные — confidence ставь скромнее (обычно 0.4-0.75).'
        : '- "confidence": 0..1, насколько ты уверен. ≥ 0.85 ставь только если формулировка чёткая и атрибуция явная.';
    const quoteLine =
      args.mode === 'forward'
        ? '- "sourceQuote": ключевая цитата из форварда.'
        : '- "sourceQuote": фрагмент исходного текста, на котором ты основал title (для аудита).';

    // SYSTEM без `today` — дата приходит в user-блоке (cache-friendly, F1).
    // Ф7 (интент): негативный класс «не задача» приклеивается в КОНЕЦ system
    // (стабильная константа, кэш не страдает). Покрывает обе ветки own/forward —
    // билдер общий, поэтому одного места достаточно.
    const system = withNotATaskDiscriminator(`Ты — AI-парсер задач из Telegram-бота. ${sourceLine}
${titleLine}
${assigneeLine}
- "suggestedDueDate": дата в формате YYYY-MM-DD, если упомянуто (сегодня / завтра / 24 мая / в пятницу). Дата «сегодня» передана в сообщении пользователя ниже. Если не упомянуто — null.
- "suggestedProjectHint": если упомянут проект/объект — короткое название или identifier; иначе null.
- "suggestedPriority": "urgent" | "high" | "medium" | "low" | null.
${confidenceLine}
${quoteLine}

Не выдумывай. Что не указано в тексте — null.`);

    const ctxBlock = formatOrgContext(args.ctx);
    const sourceHeader = args.mode === 'forward' ? 'Форвард' : 'Сообщение пользователя';
    const user = `Сегодня: ${args.today}
${ctxBlock}

${sourceHeader}:
"""
${args.text}
"""`;
    return { system, user };
  }

  private buildReplyClassifyPrompt(text: string): {
    system: string;
    user: string;
  } {
    const system = `Ты — классификатор reply пользователя на bot-уведомление о задаче. Определи kind:
- "status_command" — короткая команда статуса. Распознавай: «принял», «принято», «беру», «в работе», «+1 день», «передвинь», «завтра», «послезавтра», «не сделаю», «отмена», «отменяю», «не успею», «отказ». Заполни statusAction:
    - accept: «принял»/«беру»/«в работе»/«+».
    - postpone_one_day: «+1 день»/«завтра»/«послезавтра»/«передвинь».
    - cancel: «не сделаю»/«отмена»/«отказ».
- "comment" — обычный текст-комментарий (объяснение, вопрос, ответ по существу задачи). Заполни commentText (можно слегка нормализовать орфографию).
- "new_task" — пользователь явно создаёт ДРУГУЮ задачу («а ещё надо…», «и параллельно сделай…»).

Если не уверен — возвращай "comment". Никогда не угадывай statusAction если в тексте нет явных маркеров.`;

    const user = `Reply пользователя:
"""
${text}
"""`;
    return { system, user };
  }

  private buildDigestPrompt(payload: TelegramDigestPayload): {
    system: string;
    user: string;
  } {
    const system = `Ты — AI-помощник Коры. Сформулируй тёплый утренний дайджест задач сотрудника в Telegram. Markdown допустим (Telegram parse_mode=HTML; используй <b>...</b> для заголовков, обычный текст для остального — НЕ markdown, а HTML-теги Telegram).

Структура:
1. Короткое приветствие «☀️ Доброе утро!» (без имени; имя добавит шаблон выше).
2. Если urgentToday — секция «🔥 Срочно сегодня (N):» со списком.
3. Если inProgress — «📋 В работе (N):» со списком.
4. Если overdue — «⏰ Просрочены (N):» со списком + days_overdue.
5. Если в payload присутствует поле "sprint" — добавь отдельный блок строго в формате:
   «🎯 <b>Спринт «{cycleName}»</b> — гипотеза: {hypothesisText или «—», truncate 80 символов}.
   Сигналы ({N}): {signal1}; {signal2}; {signal3}.
   ✅ Победа: {win или «—»}.
   ▶️ Следующий шаг: {nextAction или «—»}.»
   Сигналы перечисляй через «; ». Если signals пуст — пиши «Сигналы (0): нет». Если win/nextAction null — пиши «—». Не выдумывай данные, которых нет в payload.

Каждая задача — одна строка: «• <code>IDENT</code> «title» — короткий комментарий о сроке/статусе». Не более 8 элементов на секцию (если больше — допиши «… и ещё X»).

Тон: дружелюбный, без официоза, без эмодзи внутри списка. Не используй markdown ** (звёздочки) — только HTML-теги Telegram. Не превышай 3000 символов.`;

    const user = JSON.stringify(payload);
    return { system, user };
  }

  /**
   * Fallback-дайджест без LLM (если LLM упал). Сохраняет тот же контракт
   * (HTML для Telegram parse_mode=HTML).
   */
  private renderDigestFallback(payload: TelegramDigestPayload): string {
    const parts: string[] = ['☀️ <b>Доброе утро!</b>', ''];
    if (payload.urgentToday.length > 0) {
      parts.push(`🔥 <b>Срочно сегодня (${payload.urgentToday.length}):</b>`);
      for (const i of payload.urgentToday.slice(0, 8)) {
        parts.push(
          `• <code>${escapeHtml(i.identifier)}</code> «${escapeHtml(i.title)}»` +
            (i.dueLabel ? ` — ${escapeHtml(i.dueLabel)}` : ''),
        );
      }
      parts.push('');
    }
    if (payload.inProgress.length > 0) {
      parts.push(`📋 <b>В работе (${payload.inProgress.length}):</b>`);
      for (const i of payload.inProgress.slice(0, 8)) {
        parts.push(
          `• <code>${escapeHtml(i.identifier)}</code> «${escapeHtml(i.title)}»`,
        );
      }
      parts.push('');
    }
    if (payload.overdue.length > 0) {
      parts.push(`⏰ <b>Просрочены (${payload.overdue.length}):</b>`);
      for (const i of payload.overdue.slice(0, 8)) {
        parts.push(
          `• <code>${escapeHtml(i.identifier)}</code> «${escapeHtml(i.title)}»` +
            (i.daysOverdue ? ` — на ${i.daysOverdue} дн.` : ''),
        );
      }
      parts.push('');
    }
    // Pulse Wave 5 §5.4 — sprint-блок (3 сигнала + 1 победа + 1 действие).
    if (payload.sprint) {
      const s = payload.sprint;
      const hyp = s.hypothesisText
        ? truncate(s.hypothesisText, 80)
        : '—';
      parts.push(
        `🎯 <b>Спринт «${escapeHtml(s.cycleName)}»</b> — гипотеза: ${escapeHtml(hyp)}.`,
      );
      const signalsLine =
        s.signals.length > 0
          ? `Сигналы (${s.signals.length}): ${s.signals.map(escapeHtml).join('; ')}.`
          : 'Сигналы (0): нет.';
      parts.push(signalsLine);
      parts.push(`✅ Победа: ${s.win ? escapeHtml(s.win) : '—'}.`);
      parts.push(
        `▶️ Следующий шаг: ${s.nextAction ? escapeHtml(s.nextAction) : '—'}.`,
      );
    }
    return parts.join('\n').slice(0, 3000);
  }

  /**
   * Эвристика reply: для случая когда LLM недоступна. Точечный матч русских
   * фраз. Заведомо неполная — но безопасная (по умолчанию comment).
   */
  private heuristicReplyClassify(text: string): TelegramReplyClassification {
    const lower = text.toLowerCase().trim();
    // status_command — accept
    if (/^(принял|принято|беру|в работ|плюс|\+|ок)/i.test(lower)) {
      return { kind: 'status_command', action: 'accept' };
    }
    // postpone
    if (
      /(\+ ?1 ?ден|завтра|послезавтра|передвин|сдвин|перенес)/i.test(lower)
    ) {
      return { kind: 'status_command', action: 'postpone_one_day' };
    }
    // cancel
    if (
      /(не сделаю|отмен|откажусь|отказ|не успе[юе]|не возьму)/i.test(lower)
    ) {
      return { kind: 'status_command', action: 'cancel' };
    }
    return { kind: 'comment', text };
  }
}

// ─────────────────────────── exported types ──────────────────────────────

export interface ParsedTask {
  title: string;
  suggestedAssigneeHint: string | null;
  suggestedDueDate: string | null;
  suggestedProjectHint: string | null;
  suggestedPriority: 'urgent' | 'high' | 'medium' | 'low' | null;
  confidence: number;
  sourceQuote: string | null;
}

export interface TelegramTaskParseResult {
  intakeIssueId: string | null;
  autoTriageEnqueued: boolean;
  confidence: number | null;
  suggested: {
    title: string;
    suggestedAssigneeId: string | null;
    suggestedProjectId: string | null;
    suggestedDueDate: string | null;
    suggestedPriority: 'urgent' | 'high' | 'medium' | 'low' | null;
  } | null;
  reason:
    | 'ok'
    | 'empty_text'
    | 'llm_failed'
    | 'intake_create_failed'
    | 'quality_gate_rejected';
}

export type TelegramReplyClassification =
  | {
      kind: 'status_command';
      action: 'accept' | 'postpone_one_day' | 'cancel';
    }
  | { kind: 'comment'; text: string }
  | { kind: 'new_task'; text: string }
  | { kind: 'unknown' };

export interface TelegramDigestIssueSummary {
  identifier: string;
  title: string;
  dueLabel?: string | null;
  daysOverdue?: number | null;
}

export interface TelegramDigestPayload {
  urgentToday: TelegramDigestIssueSummary[];
  inProgress: TelegramDigestIssueSummary[];
  overdue: TelegramDigestIssueSummary[];
  /**
   * Pulse Wave 5 §5.4 — sprint-секция «3 сигнала + 1 победа + 1 действие».
   * Опционально: заполняется только если у пользователя есть активный
   * Cycle (Cycle.completedAt IS NULL) с issue'ами на нём. Если у user'а
   * несколько активных Cycle — берём один с максимумом его issue'ов.
   *
   * LLM-промпт `telegram-digest-formulate` рендерит этот блок отдельной
   * строкой; fallback рендерит вручную с тем же набором эмодзи.
   */
  sprint?: TelegramDigestSprintBlock;
}

/**
 * Pulse Wave 5 §5.4 — sprint-блок Telegram-дайджеста.
 */
export interface TelegramDigestSprintBlock {
  /** Cycle.name — «Неделя 23», «Спринт продаж — июнь». */
  cycleName: string;
  /** Cycle.description (truncated to 80 chars) — гипотеза/цель спринта. null если пусто. */
  hypothesisText: string | null;
  /**
   * До 3 сигналов: top-3 active SprintHint (kind ∈ due_date_at_risk /
   * no_recent_mentions / recurring_carry_over / conflicts_with_goal),
   * плюс counter «N задач без активности >3 дней» если хинтов меньше 3.
   */
  signals: string[];
  /** Победа: identifier + title недавно закрытой задачи цикла (за 24ч). null если нет. */
  win: string | null;
  /** Действие: title actionable SprintHint (no_due_date/no_assignee/no_description). null если нет. */
  nextAction: string | null;
}

interface OrgContext {
  projects: Array<{ identifier: string; name: string }>;
  people: string[];
}

// ─────────────────────────── module-private helpers ─────────────────────

function formatOrgContext(ctx: OrgContext): string {
  const projectsLine =
    ctx.projects.length > 0
      ? `Проекты организации: ${ctx.projects.map((p) => `${p.identifier} (${p.name})`).join('; ')}.`
      : 'Проекты организации: (нет данных).';
  const peopleLine =
    ctx.people.length > 0
      ? `Сотрудники: ${ctx.people.slice(0, 30).join(', ')}.`
      : 'Сотрудники: (нет данных).';
  return `${projectsLine}\n${peopleLine}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Pulse Wave 5 §5.4 — truncate с сохранением границ слов и многоточием.
 * Используется для hypothesisText в sprint-блоке (≤80 символов).
 */
function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}T09:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return Math.round(v * 1000) / 1000;
}
