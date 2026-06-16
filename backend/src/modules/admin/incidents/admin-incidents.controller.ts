import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AdminIncidentsService } from './admin-incidents.service';
import { CreateIncidentRuleSchema, type CreateIncidentRuleDto } from './dto/admin-incidents.dto';

@ApiTags('admin-incidents')
@Controller('api/v1/admin/incidents')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminIncidentsController {
  constructor(@Inject(AdminIncidentsService) private readonly svc: AdminIncidentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Текущие инциденты: failed-jobs по всем известным BullMQ-очередям.',
  })
  async list() {
    return this.svc.listIncidents();
  }

  @Get('queues')
  @ApiOperation({
    summary: "Список BullMQ-очередей с counts и последними 3 failed-job'ами на каждую.",
  })
  async queues() {
    return this.svc.listIncidents();
  }

  @Get('rules')
  @ApiOperation({
    summary: 'MVP-stub: список алерт-правил (в памяти, не активируются).',
  })
  rules() {
    return this.svc.listRules();
  }

  @Post('rules')
  @ApiOperation({
    summary:
      'MVP-stub создание правила. Требует `confirmedNoMvp=true` (явное подтверждение, что в MVP правила не активируются). Иначе 503.',
  })
  @HttpCode(HttpStatus.CREATED)
  createRule(
    @Body(new ZodValidationPipe(CreateIncidentRuleSchema))
    dto: CreateIncidentRuleDto,
  ) {
    if (!dto.confirmedNoMvp) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'incidents_rules_mvp_inactive',
            message:
              'В MVP правила инцидентов не активируются автоматически. Передайте `confirmedNoMvp: true`, чтобы сохранить как заготовку.',
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.svc.createRule({
      name: dto.name,
      trigger: dto.trigger,
      condition: dto.condition,
      channel: dto.channel,
      enabled: dto.enabled,
    });
  }

  @Delete('rules/:id')
  @ApiOperation({ summary: 'MVP-stub удаление правила из памяти.' })
  deleteRule(@Param('id') id: string) {
    const ok = this.svc.deleteRule(id);
    return { ok };
  }
}
