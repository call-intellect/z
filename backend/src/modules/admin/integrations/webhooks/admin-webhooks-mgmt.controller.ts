import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import { AdminWebhooksMgmtService } from './admin-webhooks-mgmt.service';
import { DeliveriesQuerySchema, type DeliveriesQueryDto } from './dto/admin-webhooks-mgmt.dto';

@ApiTags('admin-integrations-webhooks')
@Controller('api/v1/admin/integrations/webhooks-mgmt')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminWebhooksMgmtController {
  constructor(
    @Inject(AdminWebhooksMgmtService)
    private readonly svc: AdminWebhooksMgmtService,
  ) {}

  @Get('active')
  @ApiOperation({
    summary: "Список активных webhook-подписок по всем tenant'ам (status=active).",
  })
  listActive() {
    return this.svc.listActive();
  }

  @Get('deliveries')
  @ApiOperation({
    summary: 'Лента доставок WebhookDelivery с cursor-paginate. Фильтры: status, подстрока URL.',
  })
  listDeliveries(
    @Query(new ZodValidationPipe(DeliveriesQuerySchema))
    query: DeliveriesQueryDto,
  ) {
    return this.svc.listDeliveries(query);
  }

  @Get('dlq')
  @ApiOperation({
    summary: 'Failed-only лента (status=failed). DLQ-обзор для разбора.',
  })
  listDlq(
    @Query(new ZodValidationPipe(DeliveriesQuerySchema))
    query: DeliveriesQueryDto,
  ) {
    return this.svc.listDlq(query);
  }

  @Post('dlq/:id/retry')
  @ApiOperation({
    summary:
      'Сбросить статус доставки в pending и попробовать переотправить (best-effort enqueue в scheduler).',
  })
  retry(@Param('id') id: string) {
    return this.svc.retryDelivery(id);
  }
}
