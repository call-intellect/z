import { z } from 'zod';

import { TTS_MAX_CHARS } from '../services/tts.service';

/**
 * DTO для `POST /api/v1/voice/synthesize`.
 *
 * `voice` — опц. override голоса OpenAI TTS. Если не передан — берётся
 * `TTS_VOICE` из ENV.
 *
 * `format` — желаемый формат аудио. По умолчанию `mp3` (универсальный).
 */
export const SynthesizeVoiceSchema = z.object({
  text: z
    .string()
    .min(1, 'text не должен быть пустым')
    .max(
      TTS_MAX_CHARS,
      `text не должен превышать ${TTS_MAX_CHARS} символов (стоимость TTS)`,
    ),
  voice: z
    .string()
    .min(1)
    .max(64)
    .optional(),
  format: z.enum(['mp3', 'opus', 'aac', 'flac']).default('mp3'),
});

export type SynthesizeVoiceDto = z.infer<typeof SynthesizeVoiceSchema>;
