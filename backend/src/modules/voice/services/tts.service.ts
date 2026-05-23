import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

/**
 * Максимальная длина текста для одного TTS-вызова (см. δ-3 §17).
 * Сделано для контроля стоимости (OpenAI TTS — $15/1M chars).
 */
export const TTS_MAX_CHARS = 500;

export class TtsError extends Error {
  public readonly origCause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TtsError';
    if (cause !== undefined) {
      this.origCause = cause;
    }
  }
}

export interface TtsSynthesizeInput {
  /** Текст для синтеза. Должен быть ≤ TTS_MAX_CHARS символов. */
  text: string;
  /** Опц. — голос для OpenAI TTS (alloy / echo / fable / onyx / nova / shimmer). */
  voice?: string;
  /** Опц. — формат аудио. По умолчанию `mp3`. */
  format?: 'mp3' | 'opus' | 'aac' | 'flac';
}

export interface TtsSynthesizeResult {
  /** Аудио-буфер (mp3 по умолчанию). */
  audio: Buffer;
  /** Реально выбранный provider (для метрик / телеметрии). */
  provider: 'openai' | 'yandex';
  /** Использованный voice (для логов / телеметрии). */
  voice: string;
  /** Размер сгенерированного аудио в байтах. */
  bytes: number;
  /** Сколько символов отправили в TTS (для cost-tracking). */
  chars: number;
}

/**
 * `TtsService` (SBA δ-3) — единая точка синтеза речи из текста.
 *
 * Поддерживает провайдеры:
 *   - `openai` (default) — OpenAI TTS API `POST /audio/speech` (модель `tts-1`).
 *     Маршрутизируется через proxy.agent-lia.ru (тот же flow, что в
 *     `OpenAiProxyService` — Bearer `<prefix>:<OPENAI_API_KEY>`), потому что
 *     прямого OpenAI-ключа на проде нет. См. CLAUDE.md / second-brain/
 *     01_projects/llm-providers-verified.md.
 *   - `yandex` — Yandex SpeechKit (опциональный, заглушка: бросает
 *     `TtsError('yandex_not_configured')`, пока не добавлен apiKey-ENV).
 *
 * Лимит: ≤ TTS_MAX_CHARS символов на один вызов. Защита от LLM-стоимости —
 * для длинных ответов клиенту следует резать на чанки на уровне concierge.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Синтезирует речь из текста в mp3. На превышение лимита — `TtsError`.
   * На ошибку upstream — `TtsError` с причиной.
   */
  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    const text = (input.text ?? '').trim();
    if (!text) {
      throw new TtsError('text_empty');
    }
    if (text.length > TTS_MAX_CHARS) {
      throw new TtsError(`text_too_long:${text.length}`);
    }

    const provider = this.cfg.voice.ttsProvider;
    const voice = input.voice ?? this.cfg.voice.ttsVoice;
    const format = input.format ?? 'mp3';

    if (provider === 'openai') {
      const audio = await this.synthesizeOpenAi({ text, voice, format });
      return {
        audio,
        provider: 'openai',
        voice,
        bytes: audio.byteLength,
        chars: text.length,
      };
    }

    if (provider === 'yandex') {
      // На δ-3 Yandex SpeechKit намеренно не имплементирован: нужен отдельный
      // API-ключ (ENV YANDEX_SPEECHKIT_API_KEY) и folder-id, которые добавим
      // отдельным sub-ТЗ. До тех пор — явный отказ.
      throw new TtsError('yandex_not_configured');
    }

    throw new TtsError(`unknown_provider:${String(provider)}`);
  }

  /**
   * OpenAI TTS через proxy.agent-lia.ru.
   * Endpoint: `POST /audio/speech` (модель `tts-1`).
   * Тело: `{ model, voice, input, response_format }`.
   * Ответ: binary audio stream (mp3 по умолчанию).
   */
  private async synthesizeOpenAi(args: {
    text: string;
    voice: string;
    format: 'mp3' | 'opus' | 'aac' | 'flac';
  }): Promise<Buffer> {
    const baseUrl = this.cfg.ai.proxy.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/audio/speech`;
    const apiKey = `${this.cfg.ai.proxy.prefix}:${this.cfg.ai.openai.apiKey}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: args.voice,
          input: args.text,
          response_format: args.format,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ url, err: message }, 'TTS OpenAI: network error');
      throw new TtsError(`openai_network:${message}`, err);
    }

    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        // ignore
      }
      this.logger.warn(
        { status: response.status, body: body.slice(0, 200) },
        'TTS OpenAI: non-ok response',
      );
      throw new TtsError(`openai_http_${response.status}:${body.slice(0, 200)}`);
    }

    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}
