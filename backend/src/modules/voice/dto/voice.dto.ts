import { z } from 'zod';

import { TTS_MAX_CHARS } from '../services/tts.service';

export const SynthesizeVoiceSchema = z.object({
  text: z
    .string()
    .min(1, 'text не должен быть пустым')
    .max(TTS_MAX_CHARS, `text не должен превышать ${TTS_MAX_CHARS} символов (стоимость TTS)`),
  voice: z.string().min(1).max(64).optional(),
  format: z.enum(['mp3', 'opus', 'aac', 'flac']).default('mp3'),
});

export type SynthesizeVoiceDto = z.infer<typeof SynthesizeVoiceSchema>;
