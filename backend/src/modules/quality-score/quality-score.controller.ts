/**
 * Контроллер quality-score (Фаза C §7).
 *
 * Endpoints:
 *   GET   /api/v1/meetings/:id/quality-score
 *   POST  /api/v1/meetings/:id/quality-score/regenerate
 *   PATCH /api/v1/org/settings/quality-score
 *   GET   /api/v1/org/settings/quality-score
 *   GET   /api/v1/org/dashboard/quality-score
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import {
  OrgDashboardQualityScoreQuerySchema,
  OrgDashboardQualityScoreResponseDto,
  OrgQualityScoreSettingsResponseDto,
  QualityScoreResponseDto,
  RegenerateQualityScoreResponseDto,
  UpdateQualityScoreSettingsBodyDto,
  UpdateQualityScoreSettingsBodySchema,
  type OrgDashboardQualityScoreQuery,
  type OrgDashboardQualityScoreResponse,
  type OrgQualityScoreSettingsResponse,
  type QualityScoreResponse,
  type UpdateQualityScoreSettingsBody,
} from './dto/quality-score.dto';
import { QualityScoreService } from './quality-score.service';

@ApiTags('quality-score')
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class QualityScoreController {
  constructor(
    @Inject(QualityScoreService) private readonly svc: QualityScoreService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ──────────────────────── meeting-level ────────────────────────

  @Get('meetings/:id/quality-score')
  @ApiOperation({ summary: 'AI-оценка качества встречи (host / org-admin).' })
  @ApiOkResponse({ type: QualityScoreResponseDto })
  async getForMeeting(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<QualityScoreResponse> {
    return this.svc.getForMeeting(id, user.id);
  }

  @Post('meetings/:id/quality-score/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Перезапустить расчёт AI-оценки качества встречи. Rate-limit 3 раза в час per meeting.',
  })
  @ApiOkResponse({ type: RegenerateQualityScoreResponseDto })
  async regenerate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ status: 'queued'; meetingId: string }> {
    const out = await this.svc.regenerate(id, user.id);
    return { status: 'queued', meetingId: out.meetingId };
  }

  // ──────────────────────── org settings ─────────────────────────

  @Get('org/settings/quality-score')
  @ApiOperation({ summary: 'Текущие настройки quality-score Org (owner / admin).' })
  @ApiOkResponse({ type: OrgQualityScoreSettingsResponseDto })
  async getOrgSettings(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OrgQualityScoreSettingsResponse & { tenantId: string }> {
    const orgId = await this.resolveOrgIdOrThrow(user.id);
    const settings = await this.svc.getOrgSettings(orgId, user.id);
    return { ...settings, tenantId: orgId };
  }

  @Patch('org/settings/quality-score')
  @ApiOperation({
    summary:
      'Обновить список типов встреч, для которых НЕ считаем AI-оценку (owner / admin).',
  })
  @ApiOkResponse({ type: OrgQualityScoreSettingsResponseDto })
  async updateOrgSettings(
    @Body(new ZodValidationPipe(UpdateQualityScoreSettingsBodySchema))
    body: UpdateQualityScoreSettingsBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OrgQualityScoreSettingsResponse & { tenantId: string }> {
    void UpdateQualityScoreSettingsBodyDto; // оставить импорт для tree-shaker'а Swagger'а
    const orgId = await this.resolveOrgIdOrThrow(user.id);
    const updated = await this.svc.updateOrgSettings(orgId, user.id, body);
    return { ...updated, tenantId: orgId };
  }

  // ──────────────────────── dashboard aggregate ──────────────────

  @Get('org/dashboard/quality-score')
  @ApiOperation({ summary: 'Агрегат AI-оценок качества встреч Org за период.' })
  @ApiOkResponse({ type: OrgDashboardQualityScoreResponseDto })
  async getOrgDashboard(
    @Query(new ZodValidationPipe(OrgDashboardQualityScoreQuerySchema))
    query: OrgDashboardQualityScoreQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OrgDashboardQualityScoreResponse & { tenantId: string }> {
    const orgId = await this.resolveOrgIdOrThrow(user.id);
    const dash = await this.svc.getOrgDashboard(orgId, user.id, query);
    return { ...dash, tenantId: orgId };
  }

  // ──────────────────────── helpers ──────────────────────────────

  /**
   * Резолвит активную Org пользователя. Используется во всех org-эндпоинтах
   * этого контроллера (по аналогии с BehaviorMetricsController).
   */
  private async resolveOrgIdOrThrow(userId: string): Promise<string> {
    const member = await this.prisma.membership.findFirst({
      where: { userId },
      select: { orgId: true },
    });
    if (!member) {
      throw new HttpException('no_active_org_membership', HttpStatus.BAD_REQUEST);
    }
    return member.orgId;
  }
}
