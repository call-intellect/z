/**
 * MeetingReportsController — Фаза E §7.
 *
 * Endpoints:
 *   GET    /api/v1/meetings/:id/reports
 *   GET    /api/v1/meetings/:id/reports/templates
 *   POST   /api/v1/meetings/:id/reports
 *   GET    /api/v1/meetings/:id/reports/:reportId
 *   POST   /api/v1/meetings/:id/reports/:reportId/regenerate
 *   DELETE /api/v1/meetings/:id/reports/:reportId
 *
 * Auth: CookieAuthGuard. RBAC внутри сервиса (host или Org-Admin).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';

import {
  CreateReportSchema,
  type CreateReportBody,
  CreateReportBodySwagger,
  ReportListItemSwagger,
  RegenerateReportSchema,
  type RegenerateReportBody,
  RegenerateReportBodySwagger,
  type MeetingReportStatusDto,
  type ReportDetailDto,
  type ReportListItemDto,
} from './dto/meeting-reports.dto';
import { MeetingReportsService } from './meeting-reports.service';

@ApiTags('meeting-reports')
@Controller('api/v1/meetings/:id/reports')
@UseGuards(CookieAuthGuard)
export class MeetingReportsController {
  constructor(
    @Inject(MeetingReportsService)
    private readonly svc: MeetingReportsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список отчётов встречи: primary (AiResult) + additional (MeetingReport). Primary первым.',
  })
  @ApiOkResponse({ type: ReportListItemSwagger, isArray: true })
  async list(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReportListItemDto[]> {
    return this.svc.list(meetingId, user.id);
  }

  @Get('templates')
  @ApiOperation({
    summary:
      'Список доступных шаблонов для модалки «Добавить отчёт» (системные + Org-овские, status=active).',
  })
  async availableTemplates(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<
    Array<{
      id: string;
      scope: 'system' | 'org';
      name: string;
      description: string | null;
      meetingType: string | null;
      taskType: string;
    }>
  > {
    return this.svc.listAvailableTemplates(meetingId, user.id);
  }

  /**
   * Rate-limit 10/мин на пользователя для защиты от автоматических спам-вызовов;
   * прикладная логика «не более 10 живых отчётов на встречу» — внутри сервиса.
   */
  @Post()
  @RequireSubscription()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Создать новый отчёт по выбранному шаблону. Async-генерация в `ai.custom-report`.',
  })
  @ApiAcceptedResponse({ type: CreateReportBodySwagger })
  async create(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(CreateReportSchema)) body: CreateReportBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ id: string; status: MeetingReportStatusDto }> {
    return this.svc.create(meetingId, user.id, body);
  }

  @Get(':reportId')
  @ApiOperation({ summary: 'Полный отчёт включая output.' })
  async detail(
    @Param('id') meetingId: string,
    @Param('reportId') reportId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReportDetailDto> {
    return this.svc.get(meetingId, reportId, user.id);
  }

  @Post(':reportId/regenerate')
  @RequireSubscription()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Перегенерация отчёта. Rate-limit 3 раза в час per report.',
  })
  async regenerate(
    @Param('id') meetingId: string,
    @Param('reportId') reportId: string,
    @Body(new ZodValidationPipe(RegenerateReportSchema))
    body: RegenerateReportBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ id: string; status: MeetingReportStatusDto }> {
    void RegenerateReportBodySwagger; // Swagger tree-shake guard.
    return this.svc.regenerate(meetingId, reportId, user.id, body);
  }

  @Delete(':reportId')
  @RequireSubscription()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Soft-delete отчёта (status=archived).' })
  async remove(
    @Param('id') meetingId: string,
    @Param('reportId') reportId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.svc.remove(meetingId, reportId, user.id);
  }
}
