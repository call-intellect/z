import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataClass } from '@prisma/client';
import { Counter, Histogram, register } from 'prom-client';

import { TypedConfigService } from '../../../common/config/index';

import type {
  DataClassAudit,
  DataClassSource,
  DerivedKind,
  SinkConfig,
} from './dataclass-policy.types';

/**
 * W4.1 — `DataClassPolicyService`.
 *
 * Источник правды: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md
 * §4 «Глобальные определения волны» + §W4.1.
 *
 * Сервис содержит ОДИН набор правил расчёта `DataClass` и `subjectPersonId`
 * для всех проекций knowledge-core (Insight, Decision, Card, SkillTrait,
 * ExecutablePersona, chat-context, …) — взамен раскиданным по 9 специалистам
 * «max(block.dataClass, 'internal')» и двум разным хелперам `elevateDataClass`
 * / `maxDataClass`.
 *
 * В W4.1 сервис работает только в SHADOW-режиме: специалисты ВЫЗЫВАЮТ
 * `derive(...)` РЯДОМ с легаси-вычислением и эмитят `compareWithLegacy(...)`
 * — но реально пишется ВСЁ ЕЩЁ значение legacy. Это даёт ≥1 неделю на сбор
 * метрики расхождений (`kc_dataclass_shadow_diff_total`) и корректировку
 * правил до переключения «enforce» в W4.2.
 *
 * Без зависимостей от Prisma / Repository — чисто функциональные правила +
 * чтение floors из AdminSetting через `TypedConfigService.getDynamic`.
 */

/**
 * Lattice DataClass: `public < internal < sensitive < private`.
 * Совпадает с `DATA_CLASS_RANK` в `ai/services/llm-router.service.ts` — не
 * импортируем оттуда, чтобы не плодить cross-module зависимость; константа
 * маленькая и стабильная (изменение порядка = изменение всей политики).
 */
export const DATACLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

/**
 * Default-floors per `kind` (v1, см. §4 ТЗ).
 *
 *   - `idea_block` — НЕТ floor'а (specialty: это сам источник, наследуем
 *     как есть).
 *   - `insight` / `decision` / `card_rollup` / `executable_persona`
 *     / `skill_profile` / `skill_trait` — `internal` (рабочий артефакт).
 *   - `chat_context` — `public` (max от source pool — реальный floor задаётся
 *     поверх в caller'е через `explicitFloor`).
 *   - `ai_usage_log` — `public` (log пишется ПОСЛЕ derive — max от input+output).
 *   - `conflict_item` — `public` (max от участников).
 *   - `idea` / `regulation` / `process` / `policy` — `internal` (приравнены
 *     к idea_block по доступу для членов Org).
 *   - `probe_event` — `internal` (служебное событие knowledge-core).
 */
const DEFAULT_FLOORS: Record<DerivedKind, DataClass> = {
  idea_block: 'public',
  insight: 'internal',
  decision: 'internal',
  card_rollup: 'internal',
  executable_persona: 'internal',
  skill_profile: 'internal',
  skill_trait: 'internal',
  idea: 'internal',
  regulation: 'internal',
  process: 'internal',
  policy: 'internal',
  chat_context: 'public',
  ai_usage_log: 'public',
  conflict_item: 'public',
  probe_event: 'internal',
};

/** Имена метрик — стабильны (нельзя переименовывать — сломает Grafana). */
const METRIC_SHADOW_DIFF = 'kc_dataclass_shadow_diff_total';
const METRIC_DERIVED = 'kc_dataclass_derived_total';
const METRIC_FLOOR_LIFTED = 'kc_dataclass_floor_lifted_total';
// W4.3 — outbound gating.
const METRIC_VIOLATION_BLOCKED = 'kc_dataclass_violation_blocked_total';
const METRIC_CAN_EMIT_LATENCY = 'kc_dataclass_canEmit_latency_ms';

/** Ключ AdminSetting'а, в котором лежит override floors v1. */
const FLOORS_ADMIN_SETTING_KEY = 'dataclass_policy:floors';

@Injectable()
export class DataClassPolicyService {
  private readonly logger = new Logger(DataClassPolicyService.name);

  /** Метрика расхождений legacy/proposed dataClass — central source of truth. */
  private readonly shadowDiffTotal: Counter<'kind' | 'legacy' | 'proposed'>;
  /** Метрика «сколько раз вообще derive вернул конкретный уровень». */
  private readonly derivedTotal: Counter<'kind' | 'level'>;
  /**
   * Метрика «floor поднял уровень источника» — индикатор того, насколько часто
   * пресет floors v1 реально подтягивает уровень (если редко — значит floors
   * можно ослабить; если часто на одном `kind` — наоборот, рассмотреть жёсткий
   * `enforce` без compare-шага в W4.2).
   */
  private readonly floorLiftedTotal: Counter<
    'kind' | 'source_level' | 'result_level'
  >;
  /**
   * W4.3 — счётчик заблокированных outbound-эмиссий. Алерт `> 0 за 5 мин`
   * (page on-call): см. `docs/policies/outbound-gating-runbook.md`.
   */
  private readonly violationBlockedTotal: Counter<
    'sink' | 'requested' | 'max_allowed'
  >;
  /** W4.3 — гистограмма латенси одного `canEmit` вызова (ms). */
  private readonly canEmitLatencyMs: Histogram<'sink' | 'outcome'>;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {
    // Идемпотентная регистрация — на hot-reload в dev/тестах prom-client
    // ругается на duplicate, поэтому переиспользуем существующий counter.
    this.shadowDiffTotal = this.getOrCreateCounter<
      'kind' | 'legacy' | 'proposed'
    >({
      name: METRIC_SHADOW_DIFF,
      help: 'W4.1 shadow-режим: сколько раз legacy и proposed dataClass дали разный результат (label proposed=новое значение из DataClassPolicyService).',
      labelNames: ['kind', 'legacy', 'proposed'],
    });
    this.derivedTotal = this.getOrCreateCounter<'kind' | 'level'>({
      name: METRIC_DERIVED,
      help: 'W4.1: сколько вызовов derive вернули данный уровень DataClass для данного kind.',
      labelNames: ['kind', 'level'],
    });
    this.floorLiftedTotal = this.getOrCreateCounter<
      'kind' | 'source_level' | 'result_level'
    >({
      name: METRIC_FLOOR_LIFTED,
      help: 'W4.1: сколько раз floor (правило v1) повысил уровень результата выше max(source).',
      labelNames: ['kind', 'source_level', 'result_level'],
    });
    this.violationBlockedTotal = this.getOrCreateCounter<
      'sink' | 'requested' | 'max_allowed'
    >({
      name: METRIC_VIOLATION_BLOCKED,
      help: 'W4.3: сколько раз outbound-эмиссия была заблокирована canEmit. Алерт >0 за 5 мин (page on-call). Лейбл sink — kind sink-а (channel_binding|issue_webhook|export|public_api), requested — payloadDataClass, max_allowed — потолок sink-а.',
      labelNames: ['sink', 'requested', 'max_allowed'],
    });
    this.canEmitLatencyMs = this.getOrCreateHistogram<'sink' | 'outcome'>({
      name: METRIC_CAN_EMIT_LATENCY,
      help: 'W4.3: латенси одного canEmit-вызова (ms). Помогает заметить деградацию gating (например, если кто-то добавит DB-чтение).',
      labelNames: ['sink', 'outcome'],
      buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100],
    });
  }

  // ─────────────────────────── публичный API ───────────────────────────

  /**
   * Основной propagation-метод. Возвращает итоговый `dataClass` +
   * `subjectPersonId` + полный `audit`-trail для записи в Json-поле проекции
   * (на W4.2 — `<Projection>.dataClassAudit`).
   *
   * Шаги (в порядке применения):
   *   1. Считаем `max(sources)` по lattice.
   *   2. Если sources пусто — берём `floor` (одно значение).
   *   3. Применяем floor для `context.kind` (см. `DEFAULT_FLOORS`,
   *      override из AdminSetting через `getFloor`). `explicitFloor` имеет
   *      приоритет над floor для `kind`.
   *   4. Private aggregation: если ≥1 источник `private` И kind ∈ {insight,
   *      decision, card_rollup, skill_profile, executable_persona,
   *      skill_trait, chat_context} И есть ≥2 разных `subjectPersonId`
   *      — понижаем до `sensitive`, `subjectPersonId=null` (анонимизация
   *      агрегата). Если ровно один subjectPersonId — оставляем `private` +
   *      этот subjectPersonId.
   *   5. Эмитим `kc_dataclass_derived_total` и опционально
   *      `kc_dataclass_floor_lifted_total`.
   */
  derive(args: {
    sources: DataClassSource[];
    context: { kind: DerivedKind; explicitFloor?: DataClass };
  }): {
    dataClass: DataClass;
    subjectPersonId: string | null;
    audit: DataClassAudit;
  } {
    const { sources, context } = args;
    const policyVersion = this.policyVersionSync();

    const inputClasses = sources.map((s) => s.dataClass);
    const maxFromSources: DataClass =
      sources.length === 0 ? 'public' : this.maxRank(inputClasses);

    // Floor: explicit > DEFAULT_FLOORS[kind].
    const floorApplied: DataClass =
      context.explicitFloor ?? DEFAULT_FLOORS[context.kind];

    // Стартовый результат: max(maxFromSources, floor).
    let result: DataClass = this.maxRank([maxFromSources, floorApplied]);
    let rule: DataClassAudit['rule'];
    if (context.explicitFloor) {
      rule = 'explicit-floor';
    } else if (sources.length <= 1 && floorApplied === maxFromSources) {
      rule = 'single-source-passthrough';
    } else {
      rule = 'max-and-floor';
    }

    // Subject person: если ровно один private источник — наследуем
    // subjectPersonId; иначе null.
    const privateSources = sources.filter((s) => s.dataClass === 'private');
    const privateSubjects = new Set(
      privateSources
        .map((s) => s.subjectPersonId)
        .filter((p): p is string => !!p),
    );

    let resultSubjectPersonId: string | null = null;

    // Private aggregation: ≥1 private + kind допускает деперсонификацию.
    const PRIVATE_AGGREGATABLE_KINDS: DerivedKind[] = [
      'insight',
      'decision',
      'card_rollup',
      'skill_profile',
      'executable_persona',
      'skill_trait',
      'chat_context',
    ];
    const isAggregatable = PRIVATE_AGGREGATABLE_KINDS.includes(context.kind);

    if (privateSources.length >= 1 && isAggregatable) {
      if (privateSubjects.size >= 2) {
        // Разные люди — анонимизируем до sensitive.
        result = 'sensitive';
        resultSubjectPersonId = null;
        rule = 'private-aggregation-to-sensitive';
      } else if (privateSubjects.size === 1) {
        // Один Person — оставляем private с его subjectPersonId.
        result = this.maxRank([result, 'private']);
        resultSubjectPersonId = [...privateSubjects][0] ?? null;
      } else {
        // private без subjectPersonId (например, persisted без owner) —
        // оставляем как есть (private), но subjectPersonId=null.
        result = this.maxRank([result, 'private']);
        resultSubjectPersonId = null;
      }
    } else if (privateSources.length >= 1) {
      // private + НЕ-агрегируемый kind — наследуем класс и (если один) subject.
      result = this.maxRank([result, 'private']);
      resultSubjectPersonId =
        privateSubjects.size === 1 ? ([...privateSubjects][0] ?? null) : null;
    }

    // Метрики.
    this.derivedTotal.inc({ kind: context.kind, level: result });
    if (
      DATACLASS_RANK[result] > DATACLASS_RANK[maxFromSources] &&
      rule !== 'private-aggregation-to-sensitive'
    ) {
      this.floorLiftedTotal.inc({
        kind: context.kind,
        source_level: maxFromSources,
        result_level: result,
      });
    }

    const audit: DataClassAudit = {
      sourceIds: sources.map((s) => s.sourceId),
      sourceKind:
        sources.length > 0 ? (sources[0]?.sourceKind ?? 'other') : 'none',
      inputClasses,
      floorApplied,
      rule,
      result,
      resultSubjectPersonId,
      derivedAt: new Date().toISOString(),
      policyVersion,
    };

    return { dataClass: result, subjectPersonId: resultSubjectPersonId, audit };
  }

  /**
   * W4.3 — Gating для outbound-каналов и export endpoints.
   *
   * Поведение:
   *   - Если `cfg.dataClassPolicy.outboundGatingEnabled === false`
   *     (kill-switch `DATACLASS_OUTBOUND_GATING_ENABLED=false`) — всегда
   *     `{allowed:true}`. Метрика latency пишется с outcome=allowed_disabled.
   *   - `kind='channel_binding'` — lattice по `maxDataClass` + subject-ACL
   *     для `private`. `private`-payload разрешён только если
   *     recipientPersonId = subjectPersonId ИЛИ `recipientIsOwnerOrSuper=true`.
   *   - `kind='issue_webhook'` — set membership по `allowedDataClasses[]`.
   *     Пустой массив трактуется как `['public', 'internal']` (см. ТЗ §W4.3).
   *   - `kind='export'` — `private` всегда reject; `sensitive` только owner.
   *   - `kind='public_api'` — принимает только `payload='public'`.
   *
   * Метрики:
   *   - `kc_dataclass_violation_blocked_total{sink,requested,max_allowed}` —
   *     инкремент на каждый allowed=false. **Алерт >0 за 5 мин (page on-call).**
   *   - `kc_dataclass_canEmit_latency_ms{sink,outcome}` — гистограмма latency.
   *
   * Reason — human-readable текст для логов / NotificationDelivery.errorReason /
   * IssueWebhookLog.errorMessage. Не предназначен для UI.
   */
  canEmit(args: {
    payloadDataClass: DataClass;
    payloadSubjectPersonId?: string | null;
    sink: SinkConfig;
  }): { allowed: boolean; reason?: string } {
    const startedAt = performance.now();
    const sinkKind = this.sinkKindLabel(args.sink);

    // Kill-switch.
    if (!this.cfg.dataClassPolicy.outboundGatingEnabled) {
      this.observeLatency(sinkKind, 'allowed_disabled', startedAt);
      return { allowed: true };
    }

    const decision = this.evaluateSink(args);

    if (!decision.allowed) {
      this.violationBlockedTotal.inc({
        sink: sinkKind,
        requested: args.payloadDataClass,
        max_allowed: decision.maxAllowedLabel ?? 'n/a',
      });
      this.logger.warn(
        {
          sink: sinkKind,
          payloadDataClass: args.payloadDataClass,
          payloadSubjectPersonId: args.payloadSubjectPersonId ?? null,
          reason: decision.reason,
          channel:
            'channel' in args.sink ? (args.sink.channel ?? null) : null,
        },
        'DataClassPolicyService.canEmit: blocked outbound emit',
      );
    }
    this.observeLatency(
      sinkKind,
      decision.allowed ? 'allowed' : 'blocked',
      startedAt,
    );

    return decision.allowed
      ? { allowed: true }
      : { allowed: false, reason: decision.reason };
  }

  /** Гранулярная логика gating per `kind`. Без метрик/логов — это снаружи. */
  private evaluateSink(args: {
    payloadDataClass: DataClass;
    payloadSubjectPersonId?: string | null;
    sink: SinkConfig;
  }): { allowed: boolean; reason?: string; maxAllowedLabel?: string } {
    const { payloadDataClass: cls, payloadSubjectPersonId } = args;
    const sink = args.sink;

    // Legacy short-hand `{ maxDataClass }` → channel_binding без subject-ACL.
    if (!('kind' in sink) || sink.kind === undefined) {
      const lattice = this.checkLattice(cls, sink.maxDataClass, sink.channel);
      return {
        allowed: lattice.allowed,
        reason: lattice.reason,
        maxAllowedLabel: sink.maxDataClass,
      };
    }

    switch (sink.kind) {
      case 'channel_binding': {
        const lattice = this.checkLattice(cls, sink.maxDataClass, sink.channel);
        if (!lattice.allowed) {
          return {
            allowed: false,
            reason: lattice.reason,
            maxAllowedLabel: sink.maxDataClass,
          };
        }
        // Subject-ACL для private.
        if (cls === 'private') {
          const sameSubject =
            payloadSubjectPersonId &&
            sink.recipientPersonId &&
            payloadSubjectPersonId === sink.recipientPersonId;
          if (!sameSubject && !sink.recipientIsOwnerOrSuper) {
            return {
              allowed: false,
              reason: `private payload requires recipient=subject (got recipientPersonId=${sink.recipientPersonId ?? 'null'}, subjectPersonId=${payloadSubjectPersonId ?? 'null'}) or owner/super_admin`,
              maxAllowedLabel: sink.maxDataClass,
            };
          }
        }
        return { allowed: true, maxAllowedLabel: sink.maxDataClass };
      }
      case 'issue_webhook': {
        const allowList: DataClass[] =
          sink.allowedDataClasses.length > 0
            ? sink.allowedDataClasses
            : ['public', 'internal'];
        if (!allowList.includes(cls)) {
          return {
            allowed: false,
            reason: `payload=${cls} not in webhook.allowedDataClasses=[${allowList.join(',')}]${
              sink.channel ? ` (webhook=${sink.channel})` : ''
            }`,
            maxAllowedLabel: allowList.join(','),
          };
        }
        return { allowed: true, maxAllowedLabel: allowList.join(',') };
      }
      case 'export': {
        if (cls === 'private') {
          return {
            allowed: false,
            reason: `export does not accept private${sink.channel ? ` (endpoint=${sink.channel})` : ''}`,
            maxAllowedLabel: 'sensitive',
          };
        }
        if (cls === 'sensitive' && !sink.ownerOnly) {
          return {
            allowed: false,
            reason: `export of sensitive requires owner role${sink.channel ? ` (endpoint=${sink.channel})` : ''}`,
            maxAllowedLabel: 'internal',
          };
        }
        return { allowed: true, maxAllowedLabel: 'sensitive' };
      }
      case 'public_api': {
        if (cls !== 'public') {
          return {
            allowed: false,
            reason: `public API accepts only public payload (got ${cls})${sink.channel ? ` (endpoint=${sink.channel})` : ''}`,
            maxAllowedLabel: 'public',
          };
        }
        return { allowed: true, maxAllowedLabel: 'public' };
      }
      default: {
        const _exhaustive: never = sink;
        void _exhaustive;
        return { allowed: false, reason: 'unknown sink kind' };
      }
    }
  }

  private checkLattice(
    payload: DataClass,
    sinkMax: DataClass,
    channelLabel?: string,
  ): { allowed: boolean; reason?: string } {
    const payloadRank = DATACLASS_RANK[payload];
    const sinkRank = DATACLASS_RANK[sinkMax];
    if (payloadRank > sinkRank) {
      return {
        allowed: false,
        reason: `payload=${payload} > sink.maxDataClass=${sinkMax}${
          channelLabel ? ` (channel=${channelLabel})` : ''
        }`,
      };
    }
    return { allowed: true };
  }

  private sinkKindLabel(sink: SinkConfig): string {
    if (!('kind' in sink) || sink.kind === undefined) return 'channel_binding';
    return sink.kind;
  }

  private observeLatency(
    sinkLabel: string,
    outcome: 'allowed' | 'blocked' | 'allowed_disabled',
    startedAt: number,
  ): void {
    const elapsedMs = performance.now() - startedAt;
    this.canEmitLatencyMs.observe(
      { sink: sinkLabel, outcome },
      Math.max(0, elapsedMs),
    );
  }

  /**
   * Возвращает floor для `kind` — сначала из AdminSetting
   * (key `dataclass_policy:floors`, ожидается JSON
   * `Record<DerivedKind, DataClass>` либо `{ kind, floor }[]`), затем —
   * fallback на `DEFAULT_FLOORS`.
   *
   * Используется снаружи и в test-helper'ах. Сам `derive` floor НЕ дёргает
   * по этому методу (синхронный путь), а читает `DEFAULT_FLOORS` напрямую +
   * `context.explicitFloor` — это сознательно: горячий путь derive не должен
   * лезть в БД на каждый вызов. Когда AdminSetting обновится — caller'ы будут
   * передавать `explicitFloor` явно, либо мы перейдём на cached map в W4.2.
   */
  async getFloor(kind: DerivedKind): Promise<DataClass> {
    try {
      const raw = await this.cfg.getDynamic<unknown>(
        FLOORS_ADMIN_SETTING_KEY,
        undefined,
        null,
      );
      if (raw && typeof raw === 'object') {
        const map = raw as Record<string, unknown>;
        const candidate = map[kind];
        if (this.isDataClass(candidate)) return candidate;
      }
    } catch (err) {
      // Сбой чтения админ-настройки не должен ломать derive — fallback на default.
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          kind,
        },
        'DataClassPolicyService.getFloor: AdminSetting недоступен, fallback на default',
      );
    }
    return DEFAULT_FLOORS[kind];
  }

  /**
   * Shadow-comparison — пишет `kc_dataclass_shadow_diff_total{kind,legacy,proposed}`
   * + warn-лог при расхождении. Безопасно вызывать в hot-path: только counter.inc()
   * и (при diff) логирование на warn-уровне.
   */
  compareWithLegacy(args: {
    legacyResult: DataClass;
    proposedResult: DataClass;
    kind: DerivedKind;
    sourceIds: string[];
  }): void {
    if (args.legacyResult === args.proposedResult) return;
    this.shadowDiffTotal.inc({
      kind: args.kind,
      legacy: args.legacyResult,
      proposed: args.proposedResult,
    });
    this.logger.warn(
      {
        kind: args.kind,
        legacy: args.legacyResult,
        proposed: args.proposedResult,
        sourceIds: args.sourceIds.slice(0, 10),
        sourcesCount: args.sourceIds.length,
        policyVersion: this.policyVersionSync(),
      },
      'DataClassPolicyService.compareWithLegacy: shadow-расхождение legacy vs proposed',
    );
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** Возвращает «строжайший» уровень по lattice (или `public` для пустого массива). */
  private maxRank(classes: DataClass[]): DataClass {
    if (classes.length === 0) return 'public';
    let best: DataClass = classes[0]!;
    for (const c of classes) {
      if (DATACLASS_RANK[c] > DATACLASS_RANK[best]) {
        best = c;
      }
    }
    return best;
  }

  private isDataClass(v: unknown): v is DataClass {
    return (
      v === 'public' || v === 'internal' || v === 'sensitive' || v === 'private'
    );
  }

  /**
   * Синхронный доступ к версии политики из ENV. AdminSetting-override не
   * предусмотрен (версия меняется деплоем кода).
   */
  private policyVersionSync(): string {
    const v = this.cfg.dataClassPolicy.version;
    return v && v.length > 0 ? v : 'v1';
  }

  /**
   * Идемпотентная регистрация Counter'а в дефолтном prom-client registry
   * (на hot-reload в dev и тестах prom-client иначе ругается duplicate).
   * Локальный аналог `BusinessMetricsService.getOrCreateCounter` — чтобы
   * не наращивать 5000-строчный business-metrics.service.ts ради 3 метрик.
   */
  private getOrCreateCounter<L extends string>(config: {
    name: string;
    help: string;
    labelNames: readonly L[];
  }): Counter<L> {
    const existing = register.getSingleMetric(config.name);
    if (existing instanceof Counter) {
      return existing as Counter<L>;
    }
    return new Counter<L>({
      name: config.name,
      help: config.help,
      labelNames: config.labelNames as L[],
    });
  }

  private getOrCreateHistogram<L extends string>(config: {
    name: string;
    help: string;
    labelNames: readonly L[];
    buckets: number[];
  }): Histogram<L> {
    const existing = register.getSingleMetric(config.name);
    if (existing instanceof Histogram) {
      return existing as Histogram<L>;
    }
    return new Histogram<L>({
      name: config.name,
      help: config.help,
      labelNames: config.labelNames as L[],
      buckets: config.buckets,
    });
  }
}
