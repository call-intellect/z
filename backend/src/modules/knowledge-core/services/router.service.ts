import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IdeaBlock, SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { CoreQueueService } from '../../core-queue/core-queue.service';

import { resolveAxisTenantTop } from './tenant-top';

/**
 * RouterService — диспетчер атомов знаний (IdeaBlock) в специалистов Слоя 3.
 * SBA α-3 §5. Архитектурное решение §11.2 зонтичного / §10.0 sub-ТЗ —
 * **статический mapping** signalType→specialist (быстрее, дешевле, прозрачнее,
 * никакого LLM-роутинга).
 *
 * Mapping (см. plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md §5):
 *   - decision | rationale | decision_basis → 3-3-decisions
 *   - regulation | process_step           → 3-1-regulations
 *   - pain | risk | churn_risk | objection → 3-5-insights
 *   - idea | feature_request               → 3-6-ideas
 *   - reasoning (если subject — employee)  → 3-7-skill
 *   - fact (если есть Customer/Vendor/Project entity) → 3-4-project-customer
 *   - knowledge_gap                        → 3-2-knowledge-clone
 *
 * Анти-fan-out: env `ROUTER_MAX_SPECIALISTS_PER_BLOCK` (default 4) — если
 * получилось больше специалистов, оставляем top-N по приоритету:
 * decisions > regulations > insights > ideas > skill > project-customer > knowledge-clone.
 *
 * На α-3 реальные consumer'ы ещё НЕ существуют (3.4 — α-6, 3.1 — α-7, и т.д.).
 * RouterService только пушит jobs в очередь `core.specialist-routing` —
 * консумеры подцепятся в соответствующих sub-TZ.
 */
@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  /**
   * Имена специалистов как ключи jobName. Не алиас: эти строки увидят
   * консумеры в их `Worker` (jobName-фильтр) — менять их = breaking change
   * для будущих специалистов.
   */
  static readonly SPECIALIST = {
    DECISIONS: '3-3-decisions',
    REGULATIONS: '3-1-regulations',
    INSIGHTS: '3-5-insights',
    IDEAS: '3-6-ideas',
    SKILL: '3-7-skill',
    PROJECT_CUSTOMER: '3-4-project-customer',
    KNOWLEDGE_CLONE: '3-2-knowledge-clone',
    // SBA α-7 wave 2 — ProcessTemplate detector (structured pipeline для
    // process_step / methodology_step параллельно с regulations).
    PROCESS_DETECTOR: '3-1-process-detector',
    // SBA β-6 — Experiment Tracker (signalType={hypothesis, result, lesson}).
    // Работает параллельно со SKILL (тот собирает индивидуальные навыки,
    // а EXPERIMENT_TRACKER — институциональную память «что попробовали и что вышло»).
    EXPERIMENT_TRACKER: '3-9-experiments',
    // SBA β-8 — PersonalRelation builder (team_friction / process_friction +
    // manages / collaborates_with). Извлекает межличностные EntityLink из
    // блоков. Параллельно с INSIGHTS (тот собирает текстовый риск/блокер,
    // а PERSONAL_RELATION — структурированный граф «кто с кем работает»).
    PERSONAL_RELATION: '3-12-personal-relation',
    // SBA Wave 2 — Specialist 3.8 (Helpfulness Agent). Извлекает паттерны
    // помощи / mentoring / поддержки из переписки в задачах, чек-инов,
    // фрагментов транскриптов. Параллельно с другими специалистами.
    HELPFULNESS: '3-8-helpfulness',
    // Goals OKR v2 (2026-06-02) — Specialist 3-14 (Goals). Авто-добыча целей
    // компании из блоков (commitment / plan_item): outcome-формулировка,
    // KNN-дедуп + иерархия родитель↔подцель, source='ai' promotionState='suggested'.
    GOALS: '3-14-goals',
  } as const;

  /**
   * Приоритет специалистов для анти-fan-out trim'а. Чем меньше число — тем
   * важнее. См. §10.0 sub-ТЗ: «decisions > regulations > insights > ideas >
   * skill > project-customer > knowledge-clone».
   */
  private static readonly PRIORITY: Record<string, number> = {
    [RouterService.SPECIALIST.DECISIONS]: 1,
    [RouterService.SPECIALIST.REGULATIONS]: 2,
    [RouterService.SPECIALIST.INSIGHTS]: 3,
    [RouterService.SPECIALIST.IDEAS]: 4,
    [RouterService.SPECIALIST.SKILL]: 5,
    [RouterService.SPECIALIST.PROJECT_CUSTOMER]: 6,
    [RouterService.SPECIALIST.KNOWLEDGE_CLONE]: 7,
    // SBA α-7 wave 2 — process-detector работает рядом с regulations, держим
    // близкий приоритет (2.5 = между REGULATIONS и INSIGHTS).
    [RouterService.SPECIALIST.PROCESS_DETECTOR]: 2.5,
    // SBA β-6 — experiment tracker имеет средний приоритет (4.5: между ideas
    // и skill). Эксперименты — стратегическая институциональная память;
    // важнее ideas, но менее срочные, чем decisions/insights/regulations.
    [RouterService.SPECIALIST.EXPERIMENT_TRACKER]: 4.5,
    // SBA β-8 — PersonalRelation чуть менее приоритетен, чем insights (3),
    // но важнее ideas (4): структурированные межличностные связи важны для COO,
    // но менее срочные, чем явные риски/проблемы.
    [RouterService.SPECIALIST.PERSONAL_RELATION]: 3.5,
    // SBA Wave 2 — Helpfulness Agent. Приоритет 5.5 — между skill и
    // project-customer: социальный вклад важнее формальной customer-аналитики,
    // но менее срочный, чем решения/риски/правила/идеи.
    [RouterService.SPECIALIST.HELPFULNESS]: 5.5,
    // Goals OKR v2 (2026-06-02) — Specialist 3-14 (Goals). Приоритет 3.8 —
    // между insights/personal-relation (3-3.5) и ideas (4): цели стратегически
    // важны, но менее срочны, чем явные риски и решения.
    [RouterService.SPECIALIST.GOALS]: 3.8,
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(LlmRouterService)
    private readonly llm?: LlmRouterService,
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Главный метод: матчит специалистов и публикует jobs в
   * `core.specialist-routing`. Возвращает список фактически выпущенных
   * специалистов (после trim'а).
   *
   * Контракт: НЕ бросает (best-effort). Если БД/Redis на секунду упали —
   * блок уже создан, повторный enqueue произойдёт при следующем block-ingest
   * (он идемпотентен по jobId).
   */
  async dispatch(block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>): Promise<{
    dispatched: string[];
    fanOutBeforeTrim: number;
  }> {
    let targets: string[];
    try {
      targets = await this.matchSpecialists(block);
    } catch (err) {
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'RouterService: matchSpecialists упал — пропускаем dispatch',
      );
      return { dispatched: [], fanOutBeforeTrim: 0 };
    }

    const fanOutBeforeTrim = targets.length;
    this.metrics.observeCoreRouterFanOut(fanOutBeforeTrim);

    const limit = this.cfg.router.maxSpecialistsPerBlock;
    let finalTargets = targets;
    if (targets.length > limit) {
      // Top-N по приоритету (меньше число = выше приоритет).
      finalTargets = [...targets]
        .sort(
          (a, b) =>
            (RouterService.PRIORITY[a] ?? 99) - (RouterService.PRIORITY[b] ?? 99),
        )
        .slice(0, limit);
      this.metrics.incCoreRouterTrimmed({ signalType: block.signalType });
      this.logger.debug(
        {
          blockId: block.id,
          requested: targets,
          kept: finalTargets,
          limit,
        },
        'RouterService: анти-fan-out — часть специалистов отброшена',
      );
    }

    const dispatched: string[] = [];
    for (const specialistName of finalTargets) {
      try {
        await this.coreQueue.enqueueSpecialistRouting({
          specialistName,
          blockId: block.id,
          tenantId: block.tenantId,
          signalType: block.signalType,
        });
        this.metrics.incCoreRouterDispatched({
          specialist: specialistName,
          signalType: block.signalType,
        });
        dispatched.push(specialistName);
      } catch (err) {
        this.logger.warn(
          {
            blockId: block.id,
            specialistName,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService: enqueueSpecialistRouting упал — продолжаем по другим специалистам',
        );
      }
    }

    return { dispatched, fanOutBeforeTrim };
  }

  /**
   * Внутренний метод — статический mapping signalType → set специалистов.
   * Дополнительные условия (subject is employee, привязка к Customer/Vendor/
   * Project) проверяются здесь же лёгкими SQL-запросами.
   */
  private async matchSpecialists(
    block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>,
  ): Promise<string[]> {
    const targets = new Set<string>();
    const signal = block.signalType;

    switch (signal) {
      case 'decision':
      case 'rationale':
      case 'decision_basis':
        targets.add(RouterService.SPECIALIST.DECISIONS);
        break;
      case 'regulation':
        targets.add(RouterService.SPECIALIST.REGULATIONS);
        break;
      case 'process_step':
        // SBA α-7 wave 2: process_step идёт ПАРАЛЛЕЛЬНО в regulations
        // (текстовое описание процесса) и в process-detector (structured
        // ProcessTemplate). Оба специалиста — разные слои представления
        // одного и того же сигнала.
        targets.add(RouterService.SPECIALIST.REGULATIONS);
        targets.add(RouterService.SPECIALIST.PROCESS_DETECTOR);
        break;
      case 'pain':
      case 'risk':
      case 'churn_risk':
      case 'objection':
        targets.add(RouterService.SPECIALIST.INSIGHTS);
        break;
      case 'idea':
      case 'feature_request':
        targets.add(RouterService.SPECIALIST.IDEAS);
        break;
      case 'reasoning': {
        // 3-7-skill — только если у блока есть subject-Person, и этот Person
        // — сотрудник (relationship='employee'). Иначе reasoning не уходит
        // в SkillProfile (нет смысла учить навыки внешнему контакту).
        const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
        if (hasEmployeeSubject) {
          targets.add(RouterService.SPECIALIST.SKILL);
        }
        break;
      }
      case 'fact': {
        // 3-4-project-customer — только если в блоке упомянуты Customer/
        // Vendor/Project entities. Без этого fact-блок никому не интересен
        // в Слое 3 (просто фиксируется в графе).
        const hasProjectOrCustomer = await this.hasProjectCustomerOrVendor(
          block.id,
        );
        if (hasProjectOrCustomer) {
          targets.add(RouterService.SPECIALIST.PROJECT_CUSTOMER);
        }
        // SBA β-2 — 3-2-knowledge-clone: fact-блок про сотрудника (Person с
        // relationship='employee', упомянутый как subject или mentioned)
        // обогащает его knowledgeProfile. Проверка дешёвая (одна JOIN-выборка
        // через IdeaBlockEntity → Entity → Person).
        const hasEmployeeMention = await this.hasEmployeeMention(block.id);
        if (hasEmployeeMention) {
          targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
        }
        break;
      }
      case 'knowledge_gap':
      case 'question':
        // SBA α-2 wave 2 — открытый вопрос без ответа также уходит в
        // KNOWLEDGE_CLONE (для δ-2 ProactiveWatcher и Clone API).
        targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
        break;
      // ── SBA α-2 wave 2: новые signalType (2026-05-23) ──
      // γ-1 SkillProfile — все типы про индивидуальные навыки и кейсы.
      // Фаза 0.5 (2026-05-29): expertise/experience/competence с employee
      // subject — это И навык (для 3-7 SkillProfile), И знание (для 3-2
      // KnowledgeProfile). Без дублирования на половину вопросов клона Z
      // ответа не будет: «у кого спросить про энергетический сектор?» —
      // KnowledgeProfile, «кому поручить внедренку Лукойлу?» — SkillProfile.
      // Cost-impact: один дополнительный enqueue per block, реальный ребилд
      // KnowledgeProfile debounce 60s, anti-fan-out cap 4 уже подрезает.
      case 'expertise':
      case 'experience':
      case 'competence':
        {
          const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
          if (hasEmployeeSubject) {
            targets.add(RouterService.SPECIALIST.SKILL);
            targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
          }
        }
        break;
      case 'lesson':
      case 'hypothesis':
      case 'result': {
        // SBA β-6 — Experiment Tracker всегда видит эти 3 сигнала (вне
        // зависимости от subject): эксперименты — институциональная память,
        // а не личный навык. SKILL также подключаем, если subject — employee
        // (тот же блок может одновременно говорить «мы попробовали X» и
        // «Маша разобралась в Y»).
        targets.add(RouterService.SPECIALIST.EXPERIMENT_TRACKER);
        const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
        if (hasEmployeeSubject) {
          targets.add(RouterService.SPECIALIST.SKILL);
        }
        break;
      }
      case 'methodology_step': {
        // SBA α-7 wave 2: methodology_step тоже структурный сигнал процесса —
        // отправляем в process-detector. Параллельно (если есть employee
        // subject) — в SKILL, как было до wave 2.
        targets.add(RouterService.SPECIALIST.PROCESS_DETECTOR);
        const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
        if (hasEmployeeSubject) {
          targets.add(RouterService.SPECIALIST.SKILL);
        }
        break;
      }
      // β-8 / γ-3 friction-сигналы — на α-3 попадают в INSIGHTS (близко к
      // pain/risk). С β-8 параллельно идут в PERSONAL_RELATION для team_friction
      // и process_friction (структурированный граф межличностных связей).
      case 'blocker':
      case 'resource_gap':
        targets.add(RouterService.SPECIALIST.INSIGHTS);
        break;
      case 'team_friction':
      case 'process_friction':
        targets.add(RouterService.SPECIALIST.INSIGHTS);
        targets.add(RouterService.SPECIALIST.PERSONAL_RELATION);
        break;
      // δ-2 / γ-2 / sales — предложения и запросы идут в IDEAS (close to
      // feature_request) до появления специализированных consumer'ов.
      case 'suggestion':
      case 'client_request':
        targets.add(RouterService.SPECIALIST.IDEAS);
        break;
      // β-6 / β-7 / β-8 — типы для будущих специалистов. На α-3 не
      // маршрутизируются (consumer ещё не существует — ExperimentTracker
      // в β-6, BrandVoice в β-7, COO/DailyCheckIn в β-8). См. также LLM-fallback
      // sub-ТЗ ниже.
      case 'brand_principle':
      case 'content_artifact':
        // no-op до появления специалистов.
        break;
      // TZ task-dedup (2026-06-16, Ф2) — сигнал «сделал / закрыл / готово» из
      // разговора. Раньше done_item был no-op; task_completed/task_status_changed
      // в switch вовсе отсутствовали (сигнал никуда не шёл). Теперь эмиттим
      // `task.completion_signalled` (по образцу commitment_status выше) — на него
      // подписан TaskCompletionHandler (operations): семантически найдёт открытую
      // Issue и заведёт ОБРАТИМЫЙ кандидат на закрытие (авто-закрытие запрещено,
      // R13). sourceType обязателен — гард от зацикливания (трекер сам эмитит
      // task_completed при ручном закрытии). Через emit, НЕ targets.add.
      case 'done_item':
      case 'task_completed':
      case 'task_status_changed':
        try {
          const sourceType = await this.resolveBlockSourceType(block.id);
          this.eventEmitter?.emit('task.completion_signalled', {
            tenantId: block.tenantId,
            blockId: block.id,
            signalType: block.signalType,
            sourceType,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId: block.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'RouterService: emit task.completion_signalled failed — продолжаем без эмита',
          );
        }
        break;
      // Goals OKR v2 (2026-06-02) — Specialist 3-14 (Goals) подписан на
      // commitment + plan_item. LLM goal-extract сам решает «цель / не цель»
      // (анти-плодёж: на не-цели вернёт isGoal=false и блок пропускается).
      case 'commitment':
      case 'plan_item':
        targets.add(RouterService.SPECIALIST.GOALS);
        break;
      // SBA β-8.2 — commitment_status больше не no-op: эмиттим событие
      // `commitment.status_received`, на которое подписан CommitmentResponseHandler
      // (operations модуль). Внутри handler найдёт исходный commitment-блок и
      // обновит его статус + создаст ребро resolves.
      case 'commitment_status':
        try {
          this.eventEmitter?.emit('commitment.status_received', {
            tenantId: block.tenantId,
            blockId: block.id,
            signalType: block.signalType,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId: block.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'RouterService: emit commitment.status_received failed — продолжаем без эмита',
          );
        }
        break;
      // SBA Wave 2 — Specialist 3.8 (Helpfulness Agent). Эти signalType
      // создаются tracker'ом / ingest'ом или другими специалистами; все 7
      // helpfulness-типов + 3 gamification-типа + task_comment/task_mention
      // диспатчатся в helpfulness специалист (он внутри решит, что извлечь).
      case 'help_provided':
      case 'proactive_hint':
      case 'mentoring':
      case 'emotional_support':
      case 'constructive_feedback':
      case 'question_unanswered':
      case 'question_acknowledged_no_action':
      case 'helped_by':
      case 'helped_to':
      case 'thanks_explicit':
      case 'task_comment':
      case 'task_mention':
        targets.add(RouterService.SPECIALIST.HELPFULNESS);
        break;
      // Прочие signalType (mood, drift, metric_change, ...).
      default:
        // SBA α-3 wave 3 — LLM-fallback роутер.
        // Static mapping не нашёл targets'ов для этого signalType — пробуем
        // через LLM (если фича-флаг включён). См. fallbackToLlm() ниже.
        break;
    }

    // SBA α-3 wave 3 — если статика дала 0 targets, пробуем LLM-fallback.
    // Контракт: НЕ заменяет static. Если static дал ≥1 target — НЕ вызываем LLM.
    if (targets.size === 0 && this.isLlmFallbackEnabled()) {
      try {
        const llmTargets = await this.fallbackToLlm(block);
        for (const t of llmTargets) targets.add(t);
      } catch (err) {
        // fallbackToLlm уже инкрементит метрику {result=llm_error} и не должен
        // throw'ить наружу, но на всякий случай — best-effort.
        this.logger.debug(
          {
            blockId: block.id,
            signalType: block.signalType,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService.matchSpecialists: LLM-fallback бросил — игнорируем',
        );
      }
    }

    return Array.from(targets);
  }

  // ─────────────────────── SBA α-3 wave 3 — LLM-fallback ───────────────

  /**
   * LLM-fallback роутер для unmatched signalType. Вызывается ТОЛЬКО когда:
   *   - статический matchSpecialists вернул 0 targets, И
   *   - feature-флаг `ROUTER_LLM_FALLBACK_ENABLED=true`.
   *
   * Алгоритм:
   *   1. Redis cache lookup по ключу `routerfallback:<signalType>:<contentHash>`.
   *      Hit → возвращаем cached list (метрика cache_hit + matched/no_match).
   *   2. Cache miss → LLM call с whitelist'ом всех специалистов + текстом блока.
   *      Принимаем только specialist names из SPECIALIST const'ы.
   *   3. SET в Redis на TTL (default 24h, env ROUTER_FALLBACK_CACHE_TTL_SECONDS).
   *   4. Метрика router_fallback_calls_total{tenant_top, result}.
   *      result ∈ matched | no_match | llm_error.
   *
   * Best-effort: любая ошибка → warn + пустой массив. Никогда не throw.
   */
  private async fallbackToLlm(
    block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>,
  ): Promise<string[]> {
    if (!this.llm) return [];
    const tenantTop = resolveAxisTenantTop(block.tenantId);

    // Загружаем содержимое блока для cache-key + промпта.
    const full = await this.prisma.ideaBlock.findUnique({
      where: { id: block.id },
      select: {
        criticalQuestion: true,
        trustedAnswer: true,
        tags: true,
      },
    });
    if (!full) {
      this.metrics.incRouterFallbackCall({ tenantTop, result: 'no_match' });
      return [];
    }

    const cacheKey = this.makeFallbackCacheKey({
      signalType: block.signalType,
      criticalQuestion: full.criticalQuestion,
      trustedAnswer: full.trustedAnswer,
    });

    // ── Cache lookup ──
    if (this.redis) {
      try {
        const cached = await this.redis.client.get(cacheKey);
        if (cached != null) {
          const parsed = parseCachedSpecialists(cached);
          this.metrics.incRouterFallbackCacheHit({ tenantTop });
          this.metrics.incRouterFallbackCall({
            tenantTop,
            result: parsed.length > 0 ? 'matched' : 'no_match',
          });
          return parsed;
        }
      } catch (err) {
        this.logger.debug(
          {
            cacheKey,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService.fallback: cache read error — пропускаем кэш',
        );
      }
    }

    // ── Б54 (K6) negative-cache lookup ──
    // При предыдущем llm_error мы записали короткоживущий negative-маркер.
    // Пока он жив — НЕ дёргаем LLM повторно (анти-шторм при сбое провайдера):
    // блоков с unmatched signalType может быть много, иначе каждый снова бьёт
    // в упавший LLM. Маркер best-effort: ошибка чтения = просто идём в LLM.
    const negativeKey = this.makeFallbackNegativeKey(cacheKey);
    if (this.redis) {
      try {
        const negative = await this.redis.client.get(negativeKey);
        if (negative != null) {
          this.metrics.incRouterFallbackCall({ tenantTop, result: 'llm_error' });
          this.logger.debug(
            { negativeKey, signalType: block.signalType },
            'RouterService.fallback: negative-маркер активен — пропускаем LLM-вызов',
          );
          return [];
        }
      } catch (err) {
        this.logger.debug(
          {
            negativeKey,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService.fallback: negative-cache read error — продолжаем',
        );
      }
    }

    // ── LLM call ──
    const whitelist = Object.values(RouterService.SPECIALIST) as string[];
    const systemPrompt = [
      'Ты — knowledge-роутер. Тебе дают один IdeaBlock и whitelist специалистов Слоя 3.',
      'Выбери 0..3 специалистов из whitelist, которым полезно увидеть этот блок. Если ни один не подходит — верни пустой массив.',
      'Отвечай строго JSON: {"specialists": ["3-3-decisions", ...]}. Никакого комментария.',
    ].join('\n');
    const userMessage = [
      `Блок (signalType=${block.signalType}).`,
      `Вопрос: ${full.criticalQuestion}`,
      `Ответ: ${full.trustedAnswer}`,
      `Теги: ${full.tags.join(', ') || '(нет)'}`,
      '',
      `Whitelist специалистов: ${whitelist.join(', ')}`,
    ].join('\n');

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (блок) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    let llmText: string;
    try {
      const result = await this.llm.call({
        taskType: 'router-fallback',
        tenantId: block.tenantId,
        systemPrompt: guardOn ? withInjectionGuard(systemPrompt) : systemPrompt,
        userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
        responseFormat: { type: 'json_object' },
        maxTokens: 200,
        sourceRef: { type: 'idea_block', id: block.id },
      });
      llmText = result.text;
    } catch (err) {
      this.metrics.incRouterFallbackCall({ tenantTop, result: 'llm_error' });
      // Б54 (K6) — записываем короткоживущий negative-маркер, чтобы остальные
      // блоки в окне сбоя не штормили упавший LLM (circuit-breaker minimal).
      // Best-effort: ошибка записи не блокирует возврат.
      if (this.redis) {
        try {
          await this.redis.client.set(
            negativeKey,
            '1',
            'EX',
            this.getRouterFallbackNegativeTtlSeconds(),
          );
        } catch (cacheErr) {
          this.logger.debug(
            {
              negativeKey,
              err:
                cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
            },
            'RouterService.fallback: negative-cache write error — пропускаем',
          );
        }
      }
      this.logger.warn(
        {
          blockId: block.id,
          signalType: block.signalType,
          err: err instanceof Error ? err.message : String(err),
        },
        'RouterService.fallback: LLM-call упал — возвращаем пусто',
      );
      return [];
    }

    const suggested = parseLlmSpecialists(llmText, whitelist);
    this.metrics.incRouterFallbackCall({
      tenantTop,
      result: suggested.length > 0 ? 'matched' : 'no_match',
    });

    // ── Cache set ──
    if (this.redis) {
      try {
        const ttl = this.getRouterFallbackTtlSeconds();
        await this.redis.client.set(
          cacheKey,
          JSON.stringify(suggested),
          'EX',
          ttl,
        );
      } catch (err) {
        this.logger.debug(
          {
            cacheKey,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService.fallback: cache write error — пропускаем',
        );
      }
    }

    return suggested;
  }

  private makeFallbackCacheKey(args: {
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
  }): string {
    const hash = createHash('sha1')
      .update(args.criticalQuestion + '\n' + args.trustedAnswer)
      .digest('hex')
      .slice(0, 16);
    return `routerfallback:${args.signalType}:${hash}`;
  }

  /**
   * Б54 (K6) — ключ negative-маркера, производный от позитивного cache-key
   * (тот же signalType+hash). Отдельное пространство `:err:` чтобы не
   * пересекаться с позитивным кэшем.
   */
  private makeFallbackNegativeKey(cacheKey: string): string {
    return `routerfallback:err:${cacheKey.slice('routerfallback:'.length)}`;
  }

  /**
   * Б54 (K6) — TTL negative-маркера при llm_error. Короткий (default 60с):
   * достаточно, чтобы погасить шторм блоков в окне сбоя, но не «залипнуть»
   * после восстановления провайдера. env ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS.
   * TODO(env-refactor): перенести в TypedConfig после фикса TS2589 в EnvSchema
   * (см. getRouterFallbackTtlSeconds).
   */
  private getRouterFallbackNegativeTtlSeconds(): number {
    const raw = process.env['ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS'];
    if (raw == null || raw === '') return 60;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return 60;
    return Math.floor(num);
  }

  /**
   * TODO(env-refactor): после фикса TS2589 в EnvSchema перенести в TypedConfig.
   * Default = false (prod safe). Включается в staging для постепенного rollout'а.
   */
  private isLlmFallbackEnabled(): boolean {
    const raw = process.env['ROUTER_LLM_FALLBACK_ENABLED'];
    if (raw == null || raw === '') return false;
    return raw === 'true' || raw === '1';
  }

  /**
   * TODO(env-refactor): после фикса TS2589 в EnvSchema перенести в TypedConfig.
   * Default = 86400 (24h). Защищает от спайков LLM-вызовов.
   */
  private getRouterFallbackTtlSeconds(): number {
    const raw = process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
    if (raw == null || raw === '') return 86400;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return 86400;
    return Math.floor(num);
  }

  /**
   * Проверяет, есть ли у блока subject-Entity, связанная с Person, который
   * сотрудник (Person.relationship='employee'). Используется для роутинга
   * reasoning → 3-7-skill.
   *
   * Дешёвый запрос: одна JOIN-комбинация IdeaBlockEntity → Entity → Person.
   */
  private async hasEmployeeSubject(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: 'subject',
        entity: {
          type: 'person',
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
            },
          },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  /**
   * TZ task-dedup (2026-06-16, Ф2) — источник блока (`SourceType`) по его
   * первому свидетельству. Нужен для гарда от зацикливания петли закрытия:
   * блок, пришедший из самого трекера (`tracker_event`), не должен порождать
   * кандидат на закрытие — иначе ручное закрытие задачи → блок → новый кандидат
   * → петля. У блока обычно одно свидетельство; берём самое раннее. Возвращает
   * код `SourceType` или 'unknown', если свидетельств нет (best-effort).
   */
  private async resolveBlockSourceType(blockId: string): Promise<string> {
    const evidence = await this.prisma.ideaBlockEvidence.findFirst({
      where: { blockId },
      orderBy: { createdAt: 'asc' },
      select: { sourceType: true },
    });
    return evidence?.sourceType ?? 'unknown';
  }

  /**
   * Проверяет, есть ли в блоке упоминание Customer/Vendor/Project entity.
   * Используется для роутинга fact → 3-4-project-customer.
   *
   * NB: используем `type in ['customer', 'vendor', 'project']` — без linkage
   * на Prisma-модели Vendor (она появилась в α-3, на старте может быть пуста),
   * чтобы матчиться сразу.
   */
  private async hasProjectCustomerOrVendor(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        entity: {
          type: { in: ['customer', 'vendor', 'project', 'client'] },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  /**
   * SBA β-2 — есть ли в блоке упоминание Person с `relationship='employee'`
   * (как subject ИЛИ как mentioned). Используется для роутинга fact-блоков
   * в 3-2-knowledge-clone (обогащение Knowledge Profile сотрудника).
   *
   * Дешёвый запрос: одна JOIN-выборка IdeaBlockEntity → Entity → Person с
   * фильтром по relationship.
   */
  private async hasEmployeeMention(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: { in: ['subject', 'mentioned'] },
        entity: {
          type: 'person',
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
            },
          },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  // Stub-метод, нужный для будущих юнит-тестов: статический matcher без БД.
  // Используется тестами специалистов в δ+ для проверки приоритетов.
  static priorityOf(specialist: string): number {
    return RouterService.PRIORITY[specialist] ?? 99;
  }
}

// Re-export для удобства потребителей — type-safe whitelist signalType.
// Дублирует Prisma `SignalType` only ради явной документации в коде RouterService.
export type RouterSignalType = SignalType;

// ─────────────────────── SBA α-3 wave 3 — helpers ──────────────────────

/**
 * Парсит сохранённый в Redis JSON-список специалистов. Возвращает [] на любую
 * ошибку (cache всегда дополнительный — никогда не источник правды).
 */
function parseCachedSpecialists(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Парсит LLM-ответ формата `{"specialists": ["3-3-decisions", ...]}` и
 * фильтрует через whitelist. Робастно к лишнему тексту и markdown-fence'ам.
 */
function parseLlmSpecialists(text: string, whitelist: string[]): string[] {
  if (!text) return [];
  const allowed = new Set(whitelist);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  const arr = (parsed as { specialists?: unknown })?.specialists;
  if (!Array.isArray(arr)) return [];
  const result: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string' && allowed.has(item) && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}
