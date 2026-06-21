import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  DAY_SIGNAL_DETECT_SYSTEM_PROMPT,
  buildDaySignalUserMessage,
} from '../prompts/day-signal-detect.prompt';

export interface DaySignalDetectResult {
  hasPlan: boolean;
  plan: { items: Array<{ text: string; priority?: number }> };
  hasReport: boolean;
  report: {
    dones: Array<{ text: string }>;
    blockers: Array<{ text: string; severity?: 'low' | 'medium' | 'high' }>;
  };
  isPersonalNonWork: boolean;
  confidence: number;
}

const PREFILTER_MARKERS = /сегодн|завтра|план|сделал|сделаю|итог|готов|задач|встреч|созвон/i;
const PREFILTER_MIN_LENGTH = 15;

function emptyResult(): DaySignalDetectResult {
  return {
    hasPlan: false,
    plan: { items: [] },
    hasReport: false,
    report: { dones: [], blockers: [] },
    isPersonalNonWork: false,
    confidence: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parsePriority(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseSeverity(value: unknown): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

@Injectable()
export class DaySignalDetectorService {
  private readonly logger = new Logger(DaySignalDetectorService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async detect(args: {
    tenantId: string;
    personId: string;
    dayText: string;
  }): Promise<DaySignalDetectResult> {
    if (!PREFILTER_MARKERS.test(args.dayText) && args.dayText.trim().length < PREFILTER_MIN_LENGTH) {
      return emptyResult();
    }

    try {
      const result = await this.llm.call({
        taskType: 'day-signal-detect',
        tenantId: args.tenantId,
        systemPrompt: DAY_SIGNAL_DETECT_SYSTEM_PROMPT,
        userMessage: buildDaySignalUserMessage(args.dayText),
        responseFormat: { type: 'json_object' },
        maxTokens: 1500,
        dataClass: 'internal',
        sourceRef: { type: 'day_signal', id: args.personId },
      });
      const parsed = this.parseDetect(result.text);
      if (parsed === null) {
        this.metrics.incPromptInvalidResponse({
          taskType: 'day-signal-detect',
          model: result.modelUsed,
          reason: 'json_parse',
        });
        return emptyResult();
      }
      return parsed;
    } catch (err) {
      this.logger.warn(
        `day-signal-detect llm.call упал для person=${args.personId}: ${(err as Error).message}`,
      );
      return emptyResult();
    }
  }

  private parseDetect(text: string): DaySignalDetectResult | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const root = asRecord(raw);
    if (root === null) return null;

    const planRecord = asRecord(root.plan);
    const items = asArray(planRecord?.items)
      .map((entry) => {
        const item = asRecord(entry);
        const itemText = nonEmptyText(item?.text);
        if (itemText === null) return null;
        const priority = parsePriority(item?.priority);
        return priority === undefined ? { text: itemText } : { text: itemText, priority };
      })
      .filter((entry): entry is { text: string; priority?: number } => entry !== null);

    const reportRecord = asRecord(root.report);
    const dones = asArray(reportRecord?.dones)
      .map((entry) => {
        const item = asRecord(entry);
        const itemText = nonEmptyText(item?.text);
        return itemText === null ? null : { text: itemText };
      })
      .filter((entry): entry is { text: string } => entry !== null);

    const blockers = asArray(reportRecord?.blockers)
      .map((entry) => {
        const item = asRecord(entry);
        const itemText = nonEmptyText(item?.text);
        if (itemText === null) return null;
        const severity = parseSeverity(item?.severity);
        return severity === undefined ? { text: itemText } : { text: itemText, severity };
      })
      .filter(
        (entry): entry is { text: string; severity?: 'low' | 'medium' | 'high' } => entry !== null,
      );

    return {
      hasPlan: Boolean(root.hasPlan),
      plan: { items },
      hasReport: Boolean(root.hasReport),
      report: { dones, blockers },
      isPersonalNonWork: Boolean(root.isPersonalNonWork),
      confidence: clampConfidence(root.confidence),
    };
  }
}
