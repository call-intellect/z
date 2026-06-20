import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DataClass, type ProbeEvent } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import {
  PROBE_FORMULATE_JSON_SCHEMA,
  PROBE_FORMULATE_SCHEMA_NAME,
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from '../knowledge-core/prompts/probe-formulate.prompt';

import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
  PROBE_REASON_LABEL_DEFAULT,
} from './probe-reason-labels';
import { passesMarkerCheck } from './probe-text.util';
import {
  PROBE_QUALITY_JUDGE_JSON_SCHEMA,
  PROBE_QUALITY_JUDGE_SCHEMA_NAME,
  PROBE_QUALITY_JUDGE_SYSTEM_PROMPT,
  PROBE_QUALITY_JUDGE_USER,
} from './prompts/probe-quality-judge.prompt';
import {
  PROBE_VALUE_GATE_JSON_SCHEMA,
  PROBE_VALUE_GATE_SCHEMA_NAME,
  PROBE_VALUE_GATE_SYSTEM_PROMPT,
  PROBE_VALUE_GATE_USER,
} from './prompts/probe-value-gate.prompt';

interface FormulatedProbe {
  question: string;
}

interface ProbeQualityVerdict {
  ok: boolean;
  issues?: string[];
  rewrite?: string;
}

interface ProbeValueGateVerdict {
  ask: boolean;
  reason: string;
}

@Injectable()
export class ProbeFormulationService {
  private readonly logger = new Logger(ProbeFormulationService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async gate(probe: ProbeEvent): Promise<ProbeValueGateVerdict> {
    let enabled: boolean;
    try {
      enabled = await this.cfg.getDynamic<boolean>(
        'probe.valueGateEnabled',
        undefined,
        true,
      );
    } catch {
      enabled = true;
    }
    if (!enabled) return { ask: true, reason: 'gate_disabled' };

    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    try {
      const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const reasonLabel =
        PROBE_REASON_LABEL[probe.reason] ?? PROBE_REASON_LABEL_DEFAULT;
      const objectName =
        this.toStringOrUndef(payload.objectName) ??
        this.toStringOrUndef(payload.contextCardTitle);
      const objectKindRu = this.toStringOrUndef(payload.objectKindRu);
      const message = this.toStringOrUndef(payload.message);
      const guarded = applyInputGuards(
        PROBE_VALUE_GATE_SYSTEM_PROMPT,
        PROBE_VALUE_GATE_USER({
          reasonLabel,
          objectName,
          objectKindRu,
          message,
        }),
        { enabled: guardOn, injection: true },
      );
      const result = await this.llm.call({
        taskType: 'probe-value-gate',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: probe.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROBE_VALUE_GATE_SCHEMA_NAME,
          schema: PROBE_VALUE_GATE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'probe', id: probe.id },
        dataClass: this.extractDataClass(payload),
      });
      const parsed = JSON.parse(result.text) as ProbeValueGateVerdict;
      if (parsed && typeof parsed.ask === 'boolean') {
        return {
          ask: parsed.ask,
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        };
      }
      return { ask: true, reason: 'gate_error' };
    } catch (err) {
      this.logger.debug(
        {
          probeEventId: probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-dispatcher: probe-value-gate упал — пропускаю вопрос (fail-open)',
      );
      return { ask: true, reason: 'gate_error' };
    }
  }

  async formulate(probe: ProbeEvent): Promise<FormulatedProbe> {
    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    const message = this.toStringOrUndef(payload.message) ?? '';
    const suggestedQuestion = this.toStringOrUndef(payload.suggestedQuestion);
    const suggestedActions = this.toStringArray(payload.suggestedActions);

    if (probe.reason === 'skill.cdm_interview' && suggestedQuestion) {
      return { question: suggestedQuestion };
    }

    const fallbackQuestion =
      suggestedQuestion ??
      PROBE_REASON_FALLBACK[probe.reason] ??
      PROBE_REASON_FALLBACK_DEFAULT;
    const fallback: FormulatedProbe = {
      question: fallbackQuestion,
    };

    try {
      const contextKind = this.toStringOrUndef(payload.contextCardKind);
      const contextTitle = this.toStringOrUndef(payload.contextCardTitle);
      const guardOn =
        this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const reasonLabel =
        PROBE_REASON_LABEL[probe.reason] ?? PROBE_REASON_LABEL_DEFAULT;
      const isReask = this.readReaskCount(payload) >= 1;
      const objectName =
        this.toStringOrUndef(payload.objectName) ??
        this.toStringOrUndef(payload.contextCardTitle);
      const objectKindRu = this.toStringOrUndef(payload.objectKindRu);
      const guarded = applyInputGuards(
        PROBE_FORMULATE_SYSTEM_PROMPT,
        PROBE_FORMULATE_USER_TEMPLATE({
          reasonLabel,
          message,
          suggestedActions,
          contextCard:
            contextKind && contextTitle
              ? { kind: contextKind, title: contextTitle }
              : null,
          isReask,
          objectName,
          objectKindRu,
        }),
        { enabled: guardOn, injection: true },
      );
      const result = await this.llm.call({
        taskType: 'probe-formulate',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: probe.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROBE_FORMULATE_SCHEMA_NAME,
          schema: PROBE_FORMULATE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'probe', id: probe.id },
        dataClass: this.extractDataClass(payload),
      });
      const parsed = JSON.parse(result.text) as FormulatedProbe;
      if (
        parsed &&
        typeof parsed.question === 'string' &&
        parsed.question.length > 0
      ) {
        return {
          question: parsed.question.slice(0, 400),
        };
      }
      return fallback;
    } catch (err) {
      this.logger.debug(
        {
          probeEventId: probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-dispatcher: probe-formulate fallback',
      );
      return fallback;
    }
  }

  async judgeQuality(probe: ProbeEvent, question: string): Promise<string> {
    let enabled: boolean;
    try {
      enabled = await this.cfg.getDynamic<boolean>(
        'probe.qualityJudgeEnabled',
        undefined,
        true,
      );
    } catch {
      enabled = true;
    }
    if (!enabled) return question;

    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    try {
      const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const objectName =
        this.toStringOrUndef(payload.objectName) ??
        this.toStringOrUndef(payload.contextCardTitle);
      const guarded = applyInputGuards(
        PROBE_QUALITY_JUDGE_SYSTEM_PROMPT,
        PROBE_QUALITY_JUDGE_USER({ question, objectName }),
        { enabled: guardOn, injection: true },
      );
      const result = await this.llm.call({
        taskType: 'probe-quality-judge',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: probe.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROBE_QUALITY_JUDGE_SCHEMA_NAME,
          schema: PROBE_QUALITY_JUDGE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'probe', id: probe.id },
        dataClass: this.extractDataClass(payload),
      });
      const verdict = JSON.parse(result.text) as ProbeQualityVerdict;
      if (verdict && verdict.ok === true) {
        this.metrics.incProbeQualityJudged({ verdict: 'ok' });
        return question;
      }
      const rewrite =
        typeof verdict?.rewrite === 'string' ? verdict.rewrite.trim() : '';
      if (verdict && verdict.ok === false && passesMarkerCheck(rewrite)) {
        this.metrics.incProbeQualityJudged({ verdict: 'rewritten' });
        this.logger.log(
          `probe-quality-judge: вопрос переформулирован (id=${probe.id} issues=${(verdict.issues ?? []).join(',')})`,
        );
        return rewrite;
      }
      this.metrics.incProbeQualityJudged({ verdict: 'kept_on_fail' });
      return question;
    } catch (err) {
      this.logger.debug(
        {
          probeEventId: probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-dispatcher: probe-quality-judge упал — отправляю исходный вопрос (best-effort)',
      );
      this.metrics.incProbeQualityJudged({ verdict: 'kept_on_fail' });
      return question;
    }
  }

  private extractDataClass(payload: Record<string, unknown>): DataClass {
    const dc = payload.dataClass;
    if (
      dc === 'public' ||
      dc === 'internal' ||
      dc === 'sensitive' ||
      dc === 'private'
    ) {
      return dc;
    }
    return 'internal';
  }

  private toStringOrUndef(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }

  private readReaskCount(payload: Record<string, unknown>): number {
    const raw = payload.reaskCount;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private toStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
}
