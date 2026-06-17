import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotImplementedException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  type RecognitionOptOutBody,
  RecognitionOptOutBodySchema,
  type RecognitionOptOutResponseDto,
} from '../dto/recognition.dto';
import { RecognitionPreferenceService } from '../services/recognition-preference.service';

@ApiTags('recognition / admin')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RecognitionAdminController {
  constructor(
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(RecognitionPreferenceService)
    private readonly pref: RecognitionPreferenceService,
  ) {}

  @Post('recognitions/:id/forward-as-self')
  @ApiOperation({
    summary: 'Руководитель «одобряет и пересылает от себя» благодарность (stub Sprint 4)',
  })
  async forwardAsSelf(
    @Param('id') recognitionId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    const canManage = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: 'org',
      act: 'manage',
    });
    if (!canManage) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только руководитель (owner / admin) может пересылать благодарности',
        },
      });
    }
    throw new NotImplementedException({
      ok: false,
      error: {
        code: 'not_implemented',
        message: 'Forward-as-self будет реализован в Sprint 4',
        recognitionId,
      },
    });
  }

  @Post('me/settings/notifications/recognition')
  @ApiOperation({
    summary: 'Опт-аут уведомлений Recognition Agent (legacy stub: noop, для совместимости фронта)',
  })
  async optOutRecognitionLegacy(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; note: string }> {
    this.requireTenant(tenantId);
    return {
      ok: true,
      note: `TODO sprint-4: подключить опт-аут уведомлений к notification-preferences (userId=${user.id})`,
    };
  }

  @Post('me/recognition-optout')
  @ApiOperation({
    summary: 'Установить видимость моих Recognition для команды (opt-out)',
  })
  async setRecognitionOptOut(
    @Body(new ZodValidationPipe(RecognitionOptOutBodySchema))
    body: RecognitionOptOutBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RecognitionOptOutResponseDto> {
    const t = this.requireTenant(tenantId);
    if (!user?.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'auth_required', message: 'Требуется авторизация' },
      });
    }
    return this.pref.set(t, user.id, body.publicVisible);
  }

  @Get('me/recognition-optout')
  @ApiOperation({
    summary: 'Текущая настройка видимости моих Recognition для команды',
  })
  async getRecognitionOptOut(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RecognitionOptOutResponseDto> {
    const t = this.requireTenant(tenantId);
    if (!user?.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'auth_required', message: 'Требуется авторизация' },
      });
    }
    return this.pref.get(t, user.id);
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
}
