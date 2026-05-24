import { Module } from '@nestjs/common';

import { VoiceStreamGateway } from './gateways/voice-stream.gateway';
import { TtsService } from './services/tts.service';
import { VoiceChannelAdapter } from './services/voice-channel-adapter.service';
import { VoiceController } from './voice.controller';

/**
 * `VoiceModule` (SBA δ-3) — REST API распознавания и синтеза речи.
 *
 *   - `VoiceController` — POST /api/v1/voice/transcribe + /synthesize.
 *   - `VoiceChannelAdapter` — helper-обёртка ASR (Vox) + TTS, переиспользуется
 *     в Telegram/MAX-адаптерах и concierge voice WS gateway.
 *   - `TtsService` — text → mp3 (OpenAI TTS через proxy.agent-lia.ru).
 *   - `VoiceStreamGateway` (T4) — WebSocket-канал `/ws/voice` для chunk-streaming
 *     голосового **ввода** в Concierge (только ASR, без TTS).
 *
 * Зависимости (через @Global модули):
 *   - VoxService (AiModule @Global) — ASR.
 *   - TypedConfigService (ConfigModule @Global) — ENV.
 *   - BusinessMetricsService (MetricsModule @Global) — метрики.
 *   - RbacService (RbacModule @Global) — voice.transcribe / voice.synthesize.
 *   - JwtService + PrismaService (AuthModule @Global / PrismaModule @Global) —
 *     WS handshake auth.
 *
 * Экспорт `VoiceChannelAdapter` нужен для использования из других модулей
 * (γ-2 Concierge, future bots). TtsService экспортируем отдельно — на случай
 * прямого использования без cardinality-метрик (например, в внутренних cron'ах).
 */
@Module({
  controllers: [VoiceController],
  providers: [TtsService, VoiceChannelAdapter, VoiceStreamGateway],
  exports: [TtsService, VoiceChannelAdapter],
})
export class VoiceModule {}
