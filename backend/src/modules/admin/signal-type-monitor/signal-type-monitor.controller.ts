import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import {
  SignalTypeMonitorService,
  type SignalTypeMonitorItem,
} from './signal-type-monitor.service';

@ApiExcludeController()
@Controller('api/v1/admin/llm/signal-type-monitor')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class SignalTypeMonitorController {
  constructor(
    @Inject(SignalTypeMonitorService)
    private readonly svc: SignalTypeMonitorService,
  ) {}

  @Get()
  async list(): Promise<{ items: SignalTypeMonitorItem[] }> {
    const items = await this.svc.listAll();
    return { items };
  }

  @Get(':tenantId')
  async getOne(@Param('tenantId') tenantId: string): Promise<SignalTypeMonitorItem> {
    const item = await this.svc.findByTenant(tenantId);
    if (!item) {
      throw new NotFoundException(
        `Для Org ${tenantId} нет рассчитанных данных signal-type matrix. Подождите следующего прогона cron-задачи (\`0 2 * * *\`) или дождитесь первой обработки IdeaBlock'ов.`,
      );
    }
    return item;
  }
}
