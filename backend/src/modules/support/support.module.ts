import { Module } from '@nestjs/common';

import { TrackerModule } from '../tracker/tracker.module';

import { SupportClientController } from './controllers/support-client.controller';
import { SupportDeskController } from './controllers/support-desk.controller';
import { SupportSlaCron } from './crons/support-sla.cron';
import { SupportAccessGuard } from './guards/support-access.guard';
import { SupportAccessService } from './services/support-access.service';
import { SupportDeskService } from './services/support-desk.service';
import { SupportIntakeService } from './services/support-intake.service';
import { SupportSlaService } from './services/support-sla.service';

/**
 * SupportModule — встроенная вендорская служба поддержки (ТЗ 2026-06-09
 * support-desk-clone, Ф1: человек отвечает, без клона/контура-изоляции).
 *
 * Зависимости:
 *   - TrackerModule — `ActivityRecorderService` (запись IssueActivity).
 *   - @Global модули (в imports не нужны): PrismaModule (PrismaService),
 *     ConfigModule (TypedConfigService), ConversationalModule
 *     (ConversationalService — дублирование сотруднику), EntitlementsModule
 *     (EntitlementService — гейт feature.support_desk), AuthModule
 *     (CookieAuthGuard).
 *
 * SLA-cron поднимается IN-PROCESS как провайдер (отдельного worker-процесса
 * в Z нет).
 */
@Module({
  imports: [TrackerModule],
  controllers: [SupportClientController, SupportDeskController],
  providers: [
    SupportAccessService,
    SupportAccessGuard,
    SupportIntakeService,
    SupportDeskService,
    SupportSlaService,
    SupportSlaCron,
  ],
  exports: [SupportAccessService],
})
export class SupportModule {}
