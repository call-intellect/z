import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateIntakeSchema,
  type CreateIntakeDto,
  ListIntakeQuerySchema,
  type ListIntakeQuery,
} from '../dto/intake/create-intake.dto';
import {
  TriageIntakeSchema,
  type TriageIntakeDto,
  UpdateIntakeSchema,
  type UpdateIntakeDto,
} from '../dto/intake/triage-intake.dto';
import type {
  IntakeResponseDto,
  ListIntakeResponse,
  TriageIntakeResult,
} from '../services/intake.service';
import { IntakeService } from '../services/intake.service';

/**
 * REST `/api/v1/intake` — входящие задачи (inbox перед триажем).
 * RBAC ResourceType='intake_issue' (read/write: admin/owner/coo).
 *
 * TODO Sprint 2: `Idempotency-Key` middleware на POST /intake (защита от
 * двойных webhook-доставок от внешних адаптеров).
 */
@ApiTags('tracker / intake')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class IntakeController {
  constructor(
    @Inject(IntakeService) private readonly svc: IntakeService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('intake')
  @ApiOperation({ summary: 'Список входящих задач (admin / project_manager)' })
  async list(
    @Query(new ZodValidationPipe(ListIntakeQuerySchema)) query: ListIntakeQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListIntakeResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(t, query);
  }

  @Post('intake')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать intake-карточку (внутренний — из webhook/чек-инов)' })
  async create(
    @Body(new ZodValidationPipe(CreateIntakeSchema)) body: CreateIntakeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IntakeResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(body, t);
  }

  @Patch('intake/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить intake-карточку (extraction / suggestions)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIntakeSchema)) body: UpdateIntakeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IntakeResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t, user.id);
  }

  @Post('intake/:id/triage')
  @RequireSubscription()
  @ApiOperation({ summary: 'Триаж: accept / reject / snooze / duplicate' })
  async triage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TriageIntakeSchema)) body: TriageIntakeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TriageIntakeResult> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.triage(id, body, t, user.id);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'intake_issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение inbox' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'intake_issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для триажа' },
      });
    }
  }
}
