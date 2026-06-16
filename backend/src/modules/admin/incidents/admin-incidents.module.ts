import { Module } from '@nestjs/common';

import { AdminIncidentsController } from './admin-incidents.controller';
import { AdminIncidentsService } from './admin-incidents.service';

@Module({
  controllers: [AdminIncidentsController],
  providers: [AdminIncidentsService],
  exports: [AdminIncidentsService],
})
export class AdminIncidentsModule {}
