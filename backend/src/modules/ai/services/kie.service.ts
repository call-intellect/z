import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { LlmError } from './llm.types';

/**
 * KIE (api.kie.ai) — мульти-формат провайдер.
 *
 * Один сервис закрывает три разных API-формата на одном host'е:
 *   - Claude   → POST `${base}/claude/v1/messages`   (Anthropic Messages-style)
 *   - GPT      → POST `${base}/codex/v1/responses`   (OpenAI Responses-style)
 *   - Gemini   → POST `${base}/${modelSlug}/v1/chat/completions`
 *                (OpenAI chat/completions, модель в URL)
 *
 * Диспатч по префиксу `input.model`: `claude-*` → Claude, `gpt-*` → GPT,
 * `gemini-*` → Gemini. Если модель не задана или префикс неизвестен —
 * `LlmError`. Модель обязательна (без неё непонятно, какой формат).
 *
 * Retry [500, 1000, 2000] на 429 / 5xx, как у DeepSeekService.
 *
 * См. карту в `second-brain/01_projects/llm-providers-verified.md` (раздел B)
 * и ТЗ `plans/tz/2026-05-24-kie-grsai-llm-router-integration.md`.
 */
@Injectable()
export class KieService {
  private readonly logger = new Logger(KieService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly retryDelaysMs = [500, 1000, 2000];
  private readonly timeoutMs = 60_000;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {
    this.apiKey = this.cfg.ai.kie.apiKey;
    this.baseUrl = this.cfg.ai.kie.baseUrl.replace(/\/+$/, '');
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const model = input.model;
    if (!model) {
      throw new LlmError(
        'KIE: input.model обязателен (по нему выбирается формат API).',
      );
    }
    const format = this.detectFormat(model);
    switch (format) {
      case 'claude':
        return this.withRetry(() => this.completeClaudeFormat(input, model));
      case 'gpt':
        return this.withRetry(() => this.completeGptFormat(input, model));
      case 'gemini':
        return this.withRetry(() => this.completeGeminiFormat(input, model));
    }
  }

  // ─────────────────────────── private ─────────────────────────────────────

  private detectFormat(model: string): 'claude' | 'gpt' | 'gemini' {
    if (model.startsWith('claude-')) return 'claude';
    if (model.startsWith('gpt-')) return 'gpt';
    if (model.startsWith('gemini-')) return 'gemini';
    throw new LlmError(
      `KIE: не распознан префикс модели «${model}». Допустимы: claude-*, gpt-*, gemini-*.`,
    );
  }

  /**
   * Claude через KIE. Anthropic Messages-формат, но top-level `system` KIE
   * не документирует — склеиваем system+user в одно user-сообщение
   * (см. smoke-llm-providers.ts §6.5). Bearer-auth, `stream: false`.
   */
  private async completeClaudeFormat(
    input: LlmCompleteInput,
    model: string,
  ): Promise<LlmCompleteOutput> {
    const url = `${this.baseUrl}/claude/v1/messages`;
    const body = {
      model,
      max_tokens: input.maxTokens ?? 1024,
      stream: false,
      messages: [
        {
          role: 'user',
          content: `${input.system.text}\n\n${input.user}`,
        },
      ],
    };
    const data = await this.postJson<{
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>(url, body);
    const text = (data.content ?? [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cachedTokens: 0,
      model,
      provider: 'kie',
    };
  }

  /**
   * GPT через KIE Responses API (`/codex/v1/responses`). Вход — массив
   * `input` c content-блоками `input_text`. Ответ — массив `output` с
   * блоками `reasoning` и `message`. `reasoning.effort` поддерживается.
   */
  private async completeGptFormat(
    input: LlmCompleteInput,
    model: string,
  ): Promise<LlmCompleteOutput> {
    const url = `${this.baseUrl}/codex/v1/responses`;
    const body: Record<string, unknown> = {
      model,
      stream: false,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `${input.system.text}\n\n${input.user}`,
            },
          ],
        },
      ],
    };
    if (input.reasoningEffort) {
      // KIE Responses принимает `low|medium|high|xhigh` — `minimal` сюда не шлём.
      const effort =
        input.reasoningEffort === 'minimal' ? 'low' : input.reasoningEffort;
      body['reasoning'] = { effort };
    }
    const data = await this.postJson<{
      output?: Array<{
        type?: string;
        role?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>(url, body);
    const msg = (data.output ?? []).find((o) => o?.type === 'message');
    const text = (msg?.content ?? [])
      .filter((c) => c?.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');
    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cachedTokens: 0,
      model,
      provider: 'kie',
    };
  }

  /**
   * Gemini через KIE direct (`/${modelSlug}/v1/chat/completions`). Модель
   * закодирована в URL — в body поле `model` НЕ передаётся. По умолчанию
   * KIE стримит — обязательно `stream:false`.
   */
  private async completeGeminiFormat(
    input: LlmCompleteInput,
    model: string,
  ): Promise<LlmCompleteOutput> {
    const url = `${this.baseUrl}/${model}/v1/chat/completions`;
    const body: Record<string, unknown> = {
      stream: false,
      include_thoughts: false,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${input.system.text}\n\n${input.user}`,
            },
          ],
        },
      ],
    };
    if (input.maxTokens !== undefined) {
      body['max_tokens'] = input.maxTokens;
    }
    if (input.reasoningEffort) {
      const effort =
        input.reasoningEffort === 'minimal' ? 'low' : input.reasoningEffort;
      body['reasoning_effort'] = effort;
    }
    const data = await this.postJson<{
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(url, body);
    const raw = data.choices?.[0]?.message?.content ?? '';
    const text =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw
              .map((p: { text?: string }) => p?.text ?? '')
              .join('')
          : String(raw);
    return {
      text,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      cachedTokens: 0,
      model,
      provider: 'kie',
    };
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new LlmError(
        `KIE HTTP ${resp.status}: ${errText.slice(0, 300)}`,
        resp.status,
      );
    }
    return (await resp.json()) as T;
  }

  /**
   * Retry на 429 / 5xx с фиксированной лестницей [500, 1000, 2000]ms.
   * Не-retriable ошибки (4xx кроме 429, parse) пробрасываем сразу.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status =
          err instanceof LlmError ? err.httpStatus : undefined;
        const isRetriable =
          status === 429 || (status !== undefined && status >= 500);
        if (!isRetriable || attempt === this.retryDelaysMs.length) {
          this.logger.warn(
            `KIE complete (${status ?? 'no-status'}): ${errMsg(err)}`,
          );
          if (err instanceof LlmError) throw err;
          throw new LlmError(`KIE: ${errMsg(err)}`, status, err);
        }
        const delayMs = this.retryDelaysMs[attempt] ?? 0;
        this.logger.warn(
          `KIE retry attempt=${attempt + 1} status=${status} delayMs=${delayMs}: ${errMsg(err)}`,
        );
        await sleep(delayMs);
      }
    }
    throw new LlmError(`KIE: исчерпали retry: ${errMsg(lastErr)}`, undefined, lastErr);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
