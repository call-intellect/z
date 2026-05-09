import { Module } from '@nestjs/common';

import { ChaptersController } from './chapters.controller';
import { ChaptersRepository } from './chapters.repository';
import { ChaptersService } from './chapters.service';

@Module({
  controllers: [ChaptersController],
  providers: [ChaptersService, ChaptersRepository],
  exports: [ChaptersService],
})
export class ChaptersModule {}
