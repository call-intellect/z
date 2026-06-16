import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  type BrandVoiceArtifactDto,
  type BrandVoiceProfileDto,
  type RebuildBrandVoiceResponseDto,
  UpdateBrandVoiceProfileSchema,
  type UpdateBrandVoiceProfileDto,
} from '../dto/brand-voice.dto';
import { BrandVoiceExtractorService } from '../services/brand-voice-extractor.service';
import { BrandVoiceService } from '../services/brand-voice.service';

@ApiTags('brand-voice')
@Controller('api/v1/brand-voice')
@UseGuards(CookieAuthGuard, TenantGuard)
export class BrandVoiceController {
  constructor(
    @Inject(BrandVoiceService)
    private readonly svc: BrandVoiceService,
    @Inject(BrandVoiceExtractorService)
    private readonly extractor: BrandVoiceExtractorService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Получить профиль «голоса бренда»' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BrandVoiceProfileDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getOrCreate(t);
  }

  @Patch()
  @ApiOperation({ summary: 'Обновить профиль (admin / marketing role)' })
  async update(
    @Body(new ZodValidationPipe(UpdateBrandVoiceProfileSchema))
    body: UpdateBrandVoiceProfileDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BrandVoiceProfileDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update({ tenantId: t, userId: user.id, body });
  }

  @Post('rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ручной trigger пересборки профиля (admin). Идемпотентен — 6h окно.',
  })
  async rebuild(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RebuildBrandVoiceResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    const r = await this.extractor.runForTenant({ tenantId: t });
    const enqueued = r.result === 'built';
    const reasonByResult: Record<typeof r.result, string> = {
      built: `Профиль собран (version=${r.profileVersion ?? '?'}).`,
      skipped_low_corpus: `Корпус brand_corpus меньше порога (${r.corpusSize} < минимум).`,
      skipped_idempotency: 'Профиль уже собирался менее 6 часов назад — пропущено.',
      llm_error: 'LLM-провайдер недоступен — попробуйте позже.',
      db_error: 'Внутренняя ошибка записи — обратитесь к админу.',
    };
    return {
      ok: true as const,
      enqueued,
      reason: reasonByResult[r.result],
    };
  }

  @Get('artifacts')
  @ApiOperation({
    summary:
      "Список Document'ов, помеченных как brand_corpus (для UI «какие документы используются»).",
  })
  async artifacts(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: BrandVoiceArtifactDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.svc.listArtifacts(t);
    return { items };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'brand_voice');
    if (!ok) throw this.forbidden('Недостаточно прав для просмотра голоса бренда');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'brand_voice');
    if (!ok)
      throw this.forbidden('Изменять голос бренда могут владелец, администратор или маркетолог');
  }

  private async requireManage(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'brand_voice',
      act: 'manage',
    });
    if (!ok)
      throw this.forbidden(
        'Запускать пересборку голоса бренда могут только владелец и администратор',
      );
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
