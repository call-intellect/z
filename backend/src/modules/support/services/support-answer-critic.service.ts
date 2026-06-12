import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  SUPPORT_ANSWER_CRITIC_JSON_SCHEMA,
  SUPPORT_ANSWER_CRITIC_SYSTEM_PROMPT,
  buildSupportAnswerCriticUserPrompt,
} from '../prompts/support-answer-critic.prompt';

/** Вердикт critic'а — что делать с ответом клона (R-INV-5). */
export type SupportCriticVerdict = 'answer' | 'clarify' | 'escalate';

export interface SupportCriticContourBlockInput {
  id: string;
  criticalQuestion: string | null;
  trustedAnswer: string | null;
}

export interface SupportCriticResult {
  groundedness: number;
  verdict: SupportCriticVerdict;
  unsupported: string[];
}

/**
 * SupportAnswerCriticService — critic обоснованности ответа клона поддержки
 * (TZ 2026-06-09 support-desk Ф3, R-INV-5, taskType `support-answer-critic`).
 *
 * Анти-галлюцинация: дешёвый judge извлекает фактические утверждения из ответа
 * клона и проверяет, подтверждается ли каждое блоками ЗАКРЫТОГО контура.
 * groundedness = supportedClaims/totalClaims. Ниже порога
 * `support_critic_min_groundedness` (AdminSetting) → вердикт НЕ `answer`.
 *
 * Все ветки fail-safe в сторону человека: при ошибке LLM / непарсимом JSON
 * возвращаем `{ groundedness: 0, verdict: 'escalate' }` — отдаём специалисту,
 * не пускаем сомнительный ответ.
 */
@Injectable()
export class SupportAnswerCriticService {
  private readonly logger = new Logger(SupportAnswerCriticService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async check(args: {
    tenantId: string;
    userId?: string;
    answer: string;
    contourBlocks: SupportCriticContourBlockInput[];
  }): Promise<SupportCriticResult> {
    const threshold = await this.cfg.getDynamic<number>(
      'support_critic_min_groundedness',
      undefined,
      0.6,
    );

    try {
      const userText = buildSupportAnswerCriticUserPrompt({
        answer: args.answer,
        contourBlocks: args.contourBlocks.map((b) => ({
          id: b.id,
          criticalQuestion: b.criticalQuestion ?? '',
          trustedAnswer: b.trustedAnswer ?? '',
        })),
      });

      const result = await this.llm.call({
        taskType: 'support-answer-critic',
        tenantId: args.tenantId,
        userId: args.userId,
        systemPrompt: SUPPORT_ANSWER_CRITIC_SYSTEM_PROMPT,
        userMessage: userText,
        maxTokens: 1500,
        responseFormat: {
          type: 'json_schema',
          name: 'support_answer_critic_response',
          strict: true,
          schema: SUPPORT_ANSWER_CRITIC_JSON_SCHEMA,
        },
      });

      const parsed = parseCriticJson(result.text);
      if (parsed === null) {
        this.logger.warn(
          { tenantId: args.tenantId, model: result.modelUsed },
          'support-answer-critic: непарсимый JSON — fail-safe escalate',
        );
        return { groundedness: 0, verdict: 'escalate', unsupported: [] };
      }

      const { groundedness, unsupported } = parsed;
      let verdict = parsed.verdict;

      // DEFENSIVE: groundedness ниже порога, но модель сказала `answer` —
      // понижаем до `clarify` (уточнить детали), не пускаем слабо обоснованный.
      if (groundedness < threshold && verdict === 'answer') {
        verdict = 'clarify';
      }

      return { groundedness, verdict, unsupported };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'support-answer-critic: LLM упал — fail-safe escalate (отдаём человеку)',
      );
      return { groundedness: 0, verdict: 'escalate', unsupported: [] };
    }
  }
}

// ─────────────────────────── helpers ───────────────────────────

interface ParsedCritic {
  groundedness: number;
  verdict: SupportCriticVerdict;
  unsupported: string[];
}

/**
 * Парсит вывод critic'а. Возвращает null при невалидном JSON/полях.
 * groundedness clamp [0,1]; verdict — только из enum (иначе escalate).
 */
function parseCriticJson(text: string): ParsedCritic | null {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as {
      groundedness?: unknown;
      verdict?: unknown;
      unsupported?: unknown;
    };

    const groundedness = clamp01(Number(parsed.groundedness));
    if (!Number.isFinite(groundedness)) return null;

    const verdict = mapVerdict(parsed.verdict);
    const unsupported = Array.isArray(parsed.unsupported)
      ? parsed.unsupported.filter((x): x is string => typeof x === 'string')
      : [];

    return { groundedness, verdict, unsupported };
  } catch {
    return null;
  }
}

function mapVerdict(raw: unknown): SupportCriticVerdict {
  if (raw === 'answer' || raw === 'clarify' || raw === 'escalate') return raw;
  // Неизвестное значение — самый консервативный вердикт.
  return 'escalate';
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
