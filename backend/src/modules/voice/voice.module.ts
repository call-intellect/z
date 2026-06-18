import { Module } from '@nestjs/common';

import { VoiceStreamGateway } from './gateways/voice-stream.gateway';
import { TtsService } from './services/tts.service';
import { VoiceChannelAdapter } from './services/voice-channel-adapter.service';
import { VoiceController } from './voice.controller';

@Module({
  controllers: [VoiceController],
  providers: [TtsService, VoiceChannelAdapter, VoiceStreamGateway],
  exports: [TtsService, VoiceChannelAdapter],
})
export class VoiceModule {}
