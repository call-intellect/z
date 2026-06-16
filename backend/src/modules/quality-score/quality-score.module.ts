import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { QualityScoreController } from './quality-score.controller';
import { QualityScoreService } from './quality-score.service';

@Module({
  imports: [AuthModule],
  controllers: [QualityScoreController],
  providers: [QualityScoreService],
  exports: [QualityScoreService],
})
export class QualityScoreModule {}
