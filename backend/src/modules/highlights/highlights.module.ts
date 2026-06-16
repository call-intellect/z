import { Module } from '@nestjs/common';

import { ClipRenderService } from './clip-render.service';
import { HighlightsController } from './highlights.controller';
import { HighlightsRepository } from './highlights.repository';
import { HighlightsService } from './highlights.service';

@Module({
  controllers: [HighlightsController],
  providers: [HighlightsService, HighlightsRepository, ClipRenderService],
  exports: [HighlightsService],
})
export class HighlightsModule {}
