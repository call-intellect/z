import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DataClass } from '@prisma/client';
import { z } from 'zod';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

import type { Segment } from './segment-builder.service';

export interface MeetingSkeletonMilestone {
  title: string;
  fromIndex?: number;
  toIndex?: number;
}

export interface MeetingSkeleton {
  agenda: string;
  milestones: MeetingSkeletonMilestone[];
  keyNames: string[];
}

const SKELETON_SEGMENT_MAX_CHARS = 80;
const SKELETON_MAX_TOKENS = 800;

const SKELETON_SYSTEM_PROMPT = `# Кто ты
Ты строишь короткое оглавление (карту) одного разговора, чтобы другой слой памяти понимал кореференции («он», «этот клиент», «тот проект»), читая лишь кусок беседы.

# Что вернуть
- agenda — одно-два предложения: о чём этот разговор в целом.
- milestones — 5–12 вех в порядке беседы: краткий заголовок смыслового куска и диапазон индексов сегментов (fromIndex/toIndex), если очевиден.
- keyNames — люди, компании и проекты, реально прозвучавшие в разговоре (без выдумок, без латинского мусора).

# Правила
- Опирайся только на то, что прозвучало; не додумывай.
- Карта справочная и сжатая, а не пересказ.
- Верни строго JSON по схеме, без markdown и пояснений.`;

const SKELETON_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['agenda', 'milestones', 'keyNames'],
  properties: {
    agenda: { type: 'string' },
    milestones: {
      type: 'array',
      minItems: 0,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string' },
          fromIndex: { type: 'integer', minimum: 0 },
          toIndex: { type: 'integer', minimum: 0 },
        },
      },
    },
    keyNames: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

const MeetingSkeletonSchema = z.object({
  agenda: z.string(),
  milestones: z
    .array(
      z.object({
        title: z.string().min(1),
        fromIndex: z.number().int().min(0).optional(),
        toIndex: z.number().int().min(0).optional(),
      }),
    )
    .max(12),
  keyNames: z.array(z.string()),
});

export function renderMeetingSkeleton(skeleton: MeetingSkeleton): string {
  const lines: string[] = [];
  const agenda = skeleton.agenda.trim();
  if (agenda.length > 0) lines.push(`Тема: ${agenda}`);
  if (skeleton.milestones.length > 0) {
    lines.push('Вехи:');
    for (const m of skeleton.milestones) {
      const title = m.title.trim();
      if (title.length === 0) continue;
      const range =
        m.fromIndex != null && m.toIndex != null
          ? ` [${m.fromIndex}–${m.toIndex}]`
          : '';
      lines.push(`- ${title}${range}`);
    }
  }
  const names = skeleton.keyNames.map((n) => n.trim()).filter((n) => n.length > 0);
  if (names.length > 0) lines.push(`Ключевые имена: ${names.join(', ')}`);
  return lines.join('\n');
}

interface BuildSkeletonArgs {
  tenantId: string;
  rawEventId: string;
  segments: Segment[];
  meetingTitle?: string | undefined;
  meetingType?: string | undefined;
  dataClass?: DataClass;
}

@Injectable()
export class MeetingSkeletonService {
  private readonly logger = new Logger(MeetingSkeletonService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async buildSkeleton(args: BuildSkeletonArgs): Promise<MeetingSkeleton | null> {
    const tenantTop = tenantTopOf(args.tenantId);
    if (args.segments.length === 0) {
      this.metrics?.incMeetingSkeleton({ tenantTop, outcome: 'empty' });
      return null;
    }

    const contextLines: string[] = [];
    if (args.meetingTitle) contextLines.push(`Заголовок: ${args.meetingTitle}`);
    if (args.meetingType) contextLines.push(`Тип: ${args.meetingType}`);
    const compressed = args.segments
      .map((s, idx) => `${idx}: ${s.text.slice(0, SKELETON_SEGMENT_MAX_CHARS)}`)
      .join('\n');
    const payload =
      contextLines.length > 0
        ? `${contextLines.join('\n')}\n\n${compressed}`
        : compressed;

    try {
      const out = await this.llm.call({
        taskType: 'meeting-skeleton',
        tenantId: args.tenantId,
        systemPrompt: withInjectionGuard(SKELETON_SYSTEM_PROMPT),
        userMessage: wrapUserData(payload),
        responseFormat: {
          type: 'json_schema',
          name: 'MeetingSkeleton',
          strict: true,
          schema: SKELETON_JSON_SCHEMA,
        },
        maxTokens: SKELETON_MAX_TOKENS,
        sourceRef: { type: 'raw-event', id: args.rawEventId },
        dataClass: args.dataClass,
      });
      const parsed = this.parse(out.text);
      this.metrics?.incMeetingSkeleton({
        tenantTop,
        outcome: parsed ? 'built' : 'failed',
      });
      return parsed;
    } catch (err) {
      this.metrics?.incMeetingSkeleton({ tenantTop, outcome: 'failed' });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          rawEventId: args.rawEventId,
          err: err instanceof Error ? err.message : String(err),
        },
        'meeting-skeleton: проход упал — окна работают без карты (fail-open)',
      );
      return null;
    }
  }

  private parse(text: string): MeetingSkeleton | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = MeetingSkeletonSchema.safeParse(raw);
    if (!parsed.success) return null;
    return {
      agenda: parsed.data.agenda,
      milestones: parsed.data.milestones.map((m) => ({
        title: m.title,
        ...(m.fromIndex != null ? { fromIndex: m.fromIndex } : {}),
        ...(m.toIndex != null ? { toIndex: m.toIndex } : {}),
      })),
      keyNames: parsed.data.keyNames,
    };
  }
}
