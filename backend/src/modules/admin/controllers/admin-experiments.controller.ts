import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import {
  FinishExperimentSchema,
  type FinishExperimentDto,
  StartExperimentSchema,
  type StartExperimentDto,
} from '../dto/admin-experiments.dto';
import { AdminExperimentsService } from '../services/admin-experiments.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

/**
 * Z-Admin A/B-эксперименты (Фаза 7 шаг 5).
 *
 *   POST /api/v1/admin/experiments              — стартовать эксперимент.
 *   GET  /api/v1/admin/experiments/:taskType    — статус (counts A/B + recentCalls).
 *   POST /api/v1/admin/experiments/:taskType/finish?winner=A|B — завершить.
 *   DELETE /api/v1/admin/experiments/:taskType  — отменить (без миграции).
 */
@ApiExcludeController()
@Controller('api/v1/admin/experiments')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminExperimentsController {
  constructor(
    @Inject(AdminExperimentsService)
    private readonly svc: AdminExperimentsService,
  ) {}

  @Post()
  async start(
    @Body(new ZodValidationPipe(StartExperimentSchema)) dto: StartExperimentDto,
  ) {
    try {
      return await this.svc.startExperiment({
        taskType: dto.taskType,
        modelB: dto.modelB,
        splitPercent: dto.splitPercent,
        durationDays: dto.durationDays,
      });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'experiment_start_failed',
          message: err instanceof Error ? err.message : 'Failed to start experiment',
        },
      });
    }
  }

  @Get(':taskType')
  async status(@Param('taskType') taskType: string) {
    const status = await this.svc.getStatus(taskType);
    if (!status) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'unknown_task_type' },
      });
    }
    return status;
  }

  @Post(':taskType/finish')
  async finish(
    @Param('taskType') taskType: string,
    @Body(new ZodValidationPipe(FinishExperimentSchema)) dto: FinishExperimentDto,
  ) {
    try {
      return await this.svc.finishExperiment({ taskType, winner: dto.winner });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'experiment_finish_failed',
          message: err instanceof Error ? err.message : 'Failed to finish experiment',
        },
      });
    }
  }

  @Delete(':taskType')
  async cancel(@Param('taskType') taskType: string) {
    try {
      return await this.svc.cancelExperiment(taskType);
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'experiment_cancel_failed',
          message: err instanceof Error ? err.message : 'Failed to cancel experiment',
        },
      });
    }
  }
}
