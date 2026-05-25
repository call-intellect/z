import {
  Controller,
  Get,
  Inject,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { AdminHealthService } from '../services/admin-health.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

/**
 * `AdminHealthController` (Admin-redesign Фаза 1, расширение).
 *
 * Overall сводка по `GET /` и отдельные подсистемы — для UI Z-Admin
 * вкладок «Очереди / БД / Эмбеддинги / Воркеры / S3 / LiveKit».
 *
 * `@ApiExcludeController` — Health-эндпоинты не публикуются в swagger,
 * чтобы не загромождать публичные доки внутренней админкой.
 */
@ApiExcludeController()
@Controller('api/v1/admin/health')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminHealthController {
  constructor(
    @Inject(AdminHealthService) private readonly svc: AdminHealthService,
  ) {}

  @Get()
  get() {
    return this.svc.getHealth();
  }

  @Get('queues')
  queues() {
    return this.svc.getQueues();
  }

  @Get('db')
  db() {
    return this.svc.getDb();
  }

  @Get('embeddings')
  embeddings() {
    return this.svc.getEmbeddings();
  }

  @Get('workers')
  workers() {
    return this.svc.getWorkers();
  }

  @Get('s3')
  s3() {
    return this.svc.getS3();
  }

  @Get('livekit')
  livekit() {
    return this.svc.getLivekit();
  }
}
