import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { LlmError } from './llm.types';
import type { LlmConnectionOverride } from './protocol-adapter/protocol-adapter.types';

@Injectable()
export class GrsaiService {
  private readonly logger = new Logger(GrsaiService.name);
  private readonly retryDelaysMs = [500, 1000, 2000];
  private readonly timeoutMs = 60_000;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  async complete(
    input: LlmCompleteInput,
    override?: LlmConnectionOverride,
  ): Promise<LlmCompleteOutput> {
    const model = input.model;
    if (!model) {
      throw new LlmError('GRSAI: input.model обязателен.');
    }
    return this.withRetry(() => this.callOnce(input, model, override));
  }

  private async callOnce(
    input: LlmCompleteInput,
    model: string,
    override?: LlmConnectionOverride,
  ): Promise<LlmCompleteOutput> {
    const { url, auth } = this.resolveEndpoint(override);
    const userText = typeof input.user === 'string' ? input.user : input.user.text;
    const body: Record<string, unknown> = {
      model,
      stream: true,
      messages: [
        { role: 'system', content: input.system.text },
        { role: 'user', content: userText },
      ],
    };
    if (input.maxTokens !== undefined) body['max_tokens'] = input.maxTokens;
    if (input.temperature !== undefined) body['temperature'] = input.temperature;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new LlmError(`GRSAI HTTP ${resp.status}: ${errText.slice(0, 300)}`, resp.status);
    }
    const { text, inputTokens, outputTokens } = await collectSse(resp);
    return {
      text,
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      model,
      provider: 'grsai',
    };
  }

  private resolveEndpoint(override?: LlmConnectionOverride): { url: string; auth: string } {
    if (override) {
      const base = override.baseUrl.replace(/\/+$/, '');
      const withV1 = base.endsWith('/v1') ? base : `${base}/v1`;
      return {
        url: `${withV1}/chat/completions`,
        auth: override.apiKey ? `Bearer ${override.apiKey}` : '',
      };
    }
    const grsaiBase = this.cfg.ai.grsai.baseUrl.replace(/\/+$/, '');
    const proxyBase = this.cfg.ai.proxy.baseUrl.replace(/\/+$/, '');
    const proxyPrefix = this.cfg.ai.proxy.prefix;
    const apiKey = this.cfg.ai.grsai.apiKey;
    const proxyRoot = proxyBase.replace(/\/v1$/, '');
    const usesProxy =
      grsaiBase === proxyBase || grsaiBase === proxyRoot || grsaiBase.startsWith(proxyRoot);
    if (usesProxy) {
      return {
        url: `${proxyRoot}/grsai/v1/chat/completions`,
        auth: `Bearer ${proxyPrefix}:${apiKey}`,
      };
    }
    const directBase = grsaiBase.endsWith('/v1') ? grsaiBase : `${grsaiBase}/v1`;
    return {
      url: `${directBase}/chat/completions`,
      auth: `Bearer ${apiKey}`,
    };
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = err instanceof LlmError ? err.httpStatus : undefined;
        const isRetriable = status === 429 || (status !== undefined && status >= 500);
        if (!isRetriable || attempt === this.retryDelaysMs.length) {
          this.logger.warn(`GRSAI complete (${status ?? 'no-status'}): ${errMsg(err)}`);
          if (err instanceof LlmError) throw err;
          throw new LlmError(`GRSAI: ${errMsg(err)}`, status, err);
        }
        const delayMs = this.retryDelaysMs[attempt] ?? 0;
        this.logger.warn(
          `GRSAI retry attempt=${attempt + 1} status=${status} delayMs=${delayMs}: ${errMsg(err)}`,
        );
        await sleep(delayMs);
      }
    }
    throw new LlmError(`GRSAI: исчерпали retry: ${errMsg(lastErr)}`, undefined, lastErr);
  }
}

async function collectSse(resp: Response): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const reader = resp.body?.getReader();
  if (!reader) {
    throw new LlmError('GRSAI: пустое тело SSE-ответа.');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const content = data.choices?.[0]?.delta?.content;
          if (content) chunks.push(content);
          if (data.usage) {
            inputTokens = data.usage.prompt_tokens ?? inputTokens;
            outputTokens = data.usage.completion_tokens ?? outputTokens;
          }
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
    resp.body?.cancel().catch(() => {});
  }
  return { text: chunks.join(''), inputTokens, outputTokens };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
