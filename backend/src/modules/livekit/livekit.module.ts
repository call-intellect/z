import { Global, Module } from '@nestjs/common';

import { LivekitService } from './livekit.service';

@Global()
@Module({
  providers: [LivekitService],
  exports: [LivekitService],
})
export class LivekitModule {}
