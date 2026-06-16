import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import type {
  BehaviorCalculatorResult,
  BehaviorDiarizationSegment,
} from './behavior-metrics-calculator';
import { FILLER_WORDS_RU } from './behavior-metrics-calculator';
import { LlmRouterService } from './llm-router.service';
import {
  BEHAVIOR_REFINE_MAX_FILLERS_PER_CALL,
  BEHAVIOR_REFINE_MAX_QUESTIONS_PER_CALL,
  BEHAVIOR_REFINE_SYSTEM_PROMPT,
  BEHAVIOR_REFINE_TOOL_INPUT_SCHEMA,
  BEHAVIOR_REFINE_TOOL_NAME,
  type BehaviorRefineFillerCandidate,
  type BehaviorRefineInput,
  type BehaviorRefineOutput,
  type BehaviorRefineQuestionCandidate,
  buildBehaviorRefineUser,
} from './prompts/behavior-refine';

const FILLER_REGEX_BY_WORD = new Map<string, RegExp>();
function fillerRegex(word: string): RegExp {
  const cached = FILLER_REGEX_BY_WORD.get(word);
  if (cached) {
    cached.lastIndex = 0;
    return cached;
  }
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^а-яёa-z])(${escaped})(?=[^а-яёa-z]|$)`, 'giu');
  FILLER_REGEX_BY_WORD.set(word, re);
  return re;
}

export interface BehaviorLlmRefineParams {
  meetingId: string;
  tenantId: string;
  segments: BehaviorDiarizationSegment[];
  speakerKeyByParticipantId: Map<string, string>;
  speakerKeyToParticipantId: Map<string, string | null>;
  baseResult: BehaviorCalculatorResult;
}

@Injectable()
export class BehaviorLlmRefineService {
  private readonly logger = new Logger(BehaviorLlmRefineService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async refine(params: BehaviorLlmRefineParams): Promise<BehaviorCalculatorResult> {
    if (!this.cfg.aiFeatures.behaviorMetricsLlmRefine) {
      return params.baseResult;
    }

    const candidates = collectCandidates(params);
    if (candidates.questions.length === 0 && candidates.fillers.length === 0) {
      return params.baseResult;
    }

    const trimmed: BehaviorRefineInput = {
      questions: candidates.questions.slice(0, BEHAVIOR_REFINE_MAX_QUESTIONS_PER_CALL),
      fillers: candidates.fillers.slice(0, BEHAVIOR_REFINE_MAX_FILLERS_PER_CALL),
    };

    let decisions: BehaviorRefineOutput | null;
    const startedAt = Date.now();
    try {
      const out = await this.llm.call({
        taskType: 'behavior-refine',
        systemPrompt: BEHAVIOR_REFINE_SYSTEM_PROMPT,
        userMessage: buildBehaviorRefineUser(trimmed),
        tenantId: params.tenantId,
        meetingId: params.meetingId,
        responseFormat: {
          type: 'json_schema',
          name: BEHAVIOR_REFINE_TOOL_NAME,
          schema: BEHAVIOR_REFINE_TOOL_INPUT_SCHEMA as Record<string, unknown>,
          strict: true,
        },
        dataClass: 'internal',
        sourceRef: { type: 'meeting', id: params.meetingId },
      });
      decisions = parseDecisions(out.text);
      this.metrics?.incBehaviorMetricsLlmRefine?.({ status: 'success' });
    } catch (err) {
      this.logger.warn(
        {
          meetingId: params.meetingId,
          tenantId: params.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'behavior-refine: LLM-вызов упал, отдаём baseResult без refine',
      );
      this.metrics?.incBehaviorMetricsLlmRefine?.({ status: 'failed' });
      return params.baseResult;
    } finally {
      this.logger.debug(
        {
          meetingId: params.meetingId,
          durationMs: Date.now() - startedAt,
          candidatesQuestions: trimmed.questions.length,
          candidatesFillers: trimmed.fillers.length,
        },
        'behavior-refine: LLM-вызов завершён',
      );
    }

    if (!decisions) return params.baseResult;
    return applyDecisions(params.baseResult, candidates, decisions);
  }
}

interface CollectedCandidates {
  questions: BehaviorRefineQuestionCandidate[];
  fillers: BehaviorRefineFillerCandidate[];
  ownership: Map<string, string | null>;
}

function collectCandidates(params: BehaviorLlmRefineParams): CollectedCandidates {
  const questions: BehaviorRefineQuestionCandidate[] = [];
  const fillers: BehaviorRefineFillerCandidate[] = [];
  const ownership = new Map<string, string | null>();

  params.segments.forEach((s, idx) => {
    const ownerKey = (s.speaker ?? '').toLowerCase();
    const ownerId = params.speakerKeyToParticipantId.get(ownerKey) ?? null;
    const text = s.text ?? '';
    if (!text) return;

    const sentences = text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim().length > 0);
    let added = 0;
    sentences.forEach((sent, sIdx) => {
      if (added >= 3) return;
      const hasQ = sent.includes('?');
      if (!hasQ && sent.split(/\s+/).length < 4) return;
      const id = `q:${idx}:${sIdx}`;
      questions.push({ id, text: sent.trim(), hasQuestionMark: hasQ });
      ownership.set(id, ownerId);
      added += 1;
    });

    for (const word of FILLER_WORDS_RU) {
      const re = fillerRegex(word);
      let m: RegExpExecArray | null;
      let wIdx = 0;
      while ((m = re.exec(text.toLowerCase())) !== null) {
        const id = `f:${idx}:${wIdx}:${word}`;
        const start = Math.max(0, m.index - 50);
        const end = Math.min(text.length, m.index + word.length + 50);
        fillers.push({ id, word, context: text.slice(start, end) });
        ownership.set(id, ownerId);
        wIdx += 1;
      }
    }
  });

  return { questions, fillers, ownership };
}

function parseDecisions(text: string): BehaviorRefineOutput | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.questions && parsed.fillers) {
      return parsed as BehaviorRefineOutput;
    }
    return null;
  } catch {
    return null;
  }
}

function applyDecisions(
  base: BehaviorCalculatorResult,
  candidates: CollectedCandidates,
  decisions: BehaviorRefineOutput,
): BehaviorCalculatorResult {
  const newQuestions = new Map<string | null, number>();
  const newFillers = new Map<string | null, number>();

  for (const q of candidates.questions) {
    const owner = candidates.ownership.get(q.id) ?? null;
    const decision = decisions.questions?.[q.id];
    const accept = typeof decision === 'boolean' ? decision : q.hasQuestionMark;
    if (!accept) continue;
    newQuestions.set(owner, (newQuestions.get(owner) ?? 0) + 1);
  }
  for (const f of candidates.fillers) {
    const owner = candidates.ownership.get(f.id) ?? null;
    const decision = decisions.fillers?.[f.id];
    const accept = typeof decision === 'boolean' ? decision : true;
    if (!accept) continue;
    newFillers.set(owner, (newFillers.get(owner) ?? 0) + 1);
  }

  const updated = base.participants.map((p) => {
    const q = newQuestions.has(p.participantId)
      ? newQuestions.get(p.participantId)!
      : p.questionCount;
    const f = newFillers.has(p.participantId)
      ? newFillers.get(p.participantId)!
      : p.fillerWordsCount;
    return { ...p, questionCount: q, fillerWordsCount: f };
  });

  return { meeting: base.meeting, participants: updated };
}
