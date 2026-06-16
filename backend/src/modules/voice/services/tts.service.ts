import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

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
  text: string;
  voice?: string;
  format?: 'mp3' | 'opus' | 'aac' | 'flac';
}

export interface TtsSynthesizeResult {
  audio: Buffer;
  provider: 'openai' | 'yandex';
  voice: string;
  bytes: number;
  chars: number;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

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
      throw new TtsError('yandex_not_configured');
    }

    throw new TtsError(`unknown_provider:${String(provider)}`);
  }

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
      } catch {}
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
