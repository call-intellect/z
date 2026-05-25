import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import { WorkersAdminService } from './workers-admin.service';

/**
 * Admin-redesign Фаза 8 — `WorkersAdminController`.
 *
 * UI Z-Admin `/admin/platform/workers` — BullMQ-inspector с действиями
 * pause / resume / retry / delete failed job.
 */
@ApiTags('admin-platform-workers')
@Controller('api/v1/admin/platform/workers')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class WorkersAdminController {
  constructor(
    @Inject(WorkersAdminService)
    private readonly svc: WorkersAdminService,
  ) {}

  @Get('queues')
  @ApiOperation({
    summary:
      'Список BullMQ-очередей: counts (waiting/active/failed/delayed/completed/paused) + статус паузы.',
  })
  list() {
    return this.svc.listQueues();
  }

  @Get('queues/:name')
  @ApiOperation({
    summary:
      'Детальная карточка одной очереди: counts + последние 20 failed + 10 completed + processing rate.',
  })
  detail(@Param('name') name: string) {
    return this.svc.getQueueDetail(name);
  }

  @Post('queues/:name/retry-failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Переотправить все failed jobs очереди (Queue.retryJobs).',
  })
  retryFailed(@Param('name') name: string) {
    return this.svc.retryFailed(name);
  }

  @Post('queues/:name/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Приостановить очередь (Queue.pause).' })
  pause(@Param('name') name: string) {
    return this.svc.pause(name);
  }

  @Post('queues/:name/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Возобновить очередь (Queue.resume).' })
  resume(@Param('name') name: string) {
    return this.svc.resume(name);
  }

  @Delete('queues/:name/failed/:jobId')
  @ApiOperation({
    summary: 'Удалить конкретный failed job из очереди (job.remove).',
  })
  deleteFailed(
    @Param('name') name: string,
    @Param('jobId') jobId: string,
  ) {
    return this.svc.deleteFailedJob(name, jobId);
  }
}
