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

export const DATACLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

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

const METRIC_SHADOW_DIFF = 'kc_dataclass_shadow_diff_total';
const METRIC_DERIVED = 'kc_dataclass_derived_total';
const METRIC_FLOOR_LIFTED = 'kc_dataclass_floor_lifted_total';
const METRIC_VIOLATION_BLOCKED = 'kc_dataclass_violation_blocked_total';
const METRIC_CAN_EMIT_LATENCY = 'kc_dataclass_canEmit_latency_ms';

const FLOORS_ADMIN_SETTING_KEY = 'dataclass_policy:floors';

@Injectable()
export class DataClassPolicyService {
  private readonly logger = new Logger(DataClassPolicyService.name);

  private readonly shadowDiffTotal: Counter<'kind' | 'legacy' | 'proposed'>;
  private readonly derivedTotal: Counter<'kind' | 'level'>;
  private readonly floorLiftedTotal: Counter<'kind' | 'source_level' | 'result_level'>;
  private readonly violationBlockedTotal: Counter<'sink' | 'requested' | 'max_allowed'>;
  private readonly canEmitLatencyMs: Histogram<'sink' | 'outcome'>;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.shadowDiffTotal = this.getOrCreateCounter<'kind' | 'legacy' | 'proposed'>({
      name: METRIC_SHADOW_DIFF,
      help: 'W4.1 shadow-режим: сколько раз legacy и proposed dataClass дали разный результат (label proposed=новое значение из DataClassPolicyService).',
      labelNames: ['kind', 'legacy', 'proposed'],
    });
    this.derivedTotal = this.getOrCreateCounter<'kind' | 'level'>({
      name: METRIC_DERIVED,
      help: 'W4.1: сколько вызовов derive вернули данный уровень DataClass для данного kind.',
      labelNames: ['kind', 'level'],
    });
    this.floorLiftedTotal = this.getOrCreateCounter<'kind' | 'source_level' | 'result_level'>({
      name: METRIC_FLOOR_LIFTED,
      help: 'W4.1: сколько раз floor (правило v1) повысил уровень результата выше max(source).',
      labelNames: ['kind', 'source_level', 'result_level'],
    });
    this.violationBlockedTotal = this.getOrCreateCounter<'sink' | 'requested' | 'max_allowed'>({
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
    const maxFromSources: DataClass = sources.length === 0 ? 'public' : this.maxRank(inputClasses);

    const floorApplied: DataClass = context.explicitFloor ?? DEFAULT_FLOORS[context.kind];

    let result: DataClass = this.maxRank([maxFromSources, floorApplied]);
    let rule: DataClassAudit['rule'];
    if (context.explicitFloor) {
      rule = 'explicit-floor';
    } else if (sources.length <= 1 && floorApplied === maxFromSources) {
      rule = 'single-source-passthrough';
    } else {
      rule = 'max-and-floor';
    }

    const privateSources = sources.filter((s) => s.dataClass === 'private');
    const privateSubjects = new Set(
      privateSources.map((s) => s.subjectPersonId).filter((p): p is string => !!p),
    );

    let resultSubjectPersonId: string | null = null;

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
        result = 'sensitive';
        resultSubjectPersonId = null;
        rule = 'private-aggregation-to-sensitive';
      } else if (privateSubjects.size === 1) {
        result = this.maxRank([result, 'private']);
        resultSubjectPersonId = [...privateSubjects][0] ?? null;
      } else {
        result = this.maxRank([result, 'private']);
        resultSubjectPersonId = null;
      }
    } else if (privateSources.length >= 1) {
      result = this.maxRank([result, 'private']);
      resultSubjectPersonId = privateSubjects.size === 1 ? ([...privateSubjects][0] ?? null) : null;
    }

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
      sourceKind: sources.length > 0 ? (sources[0]?.sourceKind ?? 'other') : 'none',
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

  canEmit(args: {
    payloadDataClass: DataClass;
    payloadSubjectPersonId?: string | null;
    sink: SinkConfig;
  }): { allowed: boolean; reason?: string } {
    const startedAt = performance.now();
    const sinkKind = this.sinkKindLabel(args.sink);

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
          channel: 'channel' in args.sink ? (args.sink.channel ?? null) : null,
        },
        'DataClassPolicyService.canEmit: blocked outbound emit',
      );
    }
    this.observeLatency(sinkKind, decision.allowed ? 'allowed' : 'blocked', startedAt);

    return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
  }

  private evaluateSink(args: {
    payloadDataClass: DataClass;
    payloadSubjectPersonId?: string | null;
    sink: SinkConfig;
  }): { allowed: boolean; reason?: string; maxAllowedLabel?: string } {
    const { payloadDataClass: cls, payloadSubjectPersonId } = args;
    const sink = args.sink;

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
          sink.allowedDataClasses.length > 0 ? sink.allowedDataClasses : ['public', 'internal'];
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
    this.canEmitLatencyMs.observe({ sink: sinkLabel, outcome }, Math.max(0, elapsedMs));
  }

  async getFloor(kind: DerivedKind): Promise<DataClass> {
    try {
      const raw = await this.cfg.getDynamic<unknown>(FLOORS_ADMIN_SETTING_KEY, undefined, null);
      if (raw && typeof raw === 'object') {
        const map = raw as Record<string, unknown>;
        const candidate = map[kind];
        if (this.isDataClass(candidate)) return candidate;
      }
    } catch (err) {
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
    return v === 'public' || v === 'internal' || v === 'sensitive' || v === 'private';
  }

  private policyVersionSync(): string {
    const v = this.cfg.dataClassPolicy.version;
    return v && v.length > 0 ? v : 'v1';
  }

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
