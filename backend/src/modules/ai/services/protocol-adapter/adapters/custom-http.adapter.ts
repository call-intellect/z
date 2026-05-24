import { Injectable, Logger } from '@nestjs/common';

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
} from '../../llm.types';
import { LlmError } from '../../llm.types';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

/**
 * SBA α-10 wave 3 — Custom HTTP адаптер (generic).
 *
 * Минимальная реализация для внутренних корпоративных моделей: POST {baseUrl},
 * JSON body { system, user, model, maxTokens }, ответ { text, inputTokens?,
 * outputTokens? }. На MVP не используется в проде, но регистрируется для
 * расширяемости (см. ТЗ §3.5).
 *
 * Если в будущем понадобится индивидуальная карта полей — заводить
 * подкласс или хранить mapping в LlmProvider.defaultHeaders/config.
 */
@Injectable()
export class CustomHttpProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'custom-http';
  private readonly logger = new Logger(CustomHttpProtocolAdapter.name);

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    const model = input.model ?? provider.defaultModel ?? 'default';

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(provider.defaultHeaders ?? {}),
    };
    if (provider.apiKey) {
      headers['authorization'] = `Bearer ${provider.apiKey}`;
    }

    let resp: Response;
    try {
      // T7-F3: распаковка LlmUserInput (см. openai-chat.adapter.ts).
      const userText = typeof input.user === 'string' ? input.user : input.user.text;
      resp = await fetch(provider.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          system: input.system.text,
          user: userText,
          model,
          maxTokens: input.maxTokens,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(
        `custom-http ${provider.name}: network error: ${message}`,
        undefined,
        err,
      );
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new LlmError(
        `custom-http ${provider.name}: HTTP ${resp.status}: ${body.slice(0, 500)}`,
        resp.status,
      );
    }
    type CustomBody = {
      text?: string;
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
    };
    let body: CustomBody;
    try {
      body = (await resp.json()) as CustomBody;
    } catch (err) {
      throw new LlmError(
        `custom-http ${provider.name}: невалидный JSON в ответе`,
        resp.status,
        err,
      );
    }
    return {
      text: body.text ?? '',
      inputTokens: body.inputTokens ?? 0,
      outputTokens: body.outputTokens ?? 0,
      cachedTokens: body.cachedTokens ?? 0,
      model,
      provider: 'openai-via-proxy',
    };
  }
}
