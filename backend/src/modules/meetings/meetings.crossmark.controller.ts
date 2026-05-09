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
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { CurrentPartner, type CurrentPartnerPayload } from '../auth/decorators/current-partner.decorator';
import { HmacGuard } from '../auth/guards/hmac.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import {
  type CreateMeetingDto,
  CreateMeetingSchema,
} from './dto/create-meeting.dto';
import type { MeetingPublicDto } from './dto/meeting-public.dto';
import { MeetingsService } from './meetings.service';

/**
 * Crossmark integration endpoints (HMAC + idempotency).
 * Roles: server-to-server, без CORS, без cookies.
 */
@ApiExcludeController()
@Controller('integrations/crossmark/v1/meetings')
@UseGuards(HmacGuard)
@UseInterceptors(IdempotencyInterceptor)
export class MeetingsCrossmarkController {
  constructor(
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateMeetingSchema)) dto: CreateMeetingDto,
    @CurrentPartner() partner: CurrentPartnerPayload,
  ): Promise<{ meeting_id: string; deep_link: string; expires_at: string }> {
    const result = await this.meetings.createFromCrossmark(
      {
        host: {
          externalId: dto.host.external_id,
          email: dto.host.email,
          name: dto.host.name,
        },
        type: dto.type,
        title: dto.title,
        customPrompt: dto.custom_prompt ?? null,
      },
      partner.id,
    );

    return {
      meeting_id: result.meetingId,
      deep_link: result.deepLink,
      expires_at: result.expiresAt.toISOString(),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<MeetingPublicDto> {
    const dto = await this.meetings.getForCrossmark(id);
    this.metrics.incCrossmarkApiRequest('GET /meetings/:id', 200);
    return dto;
  }

  @Delete(':id')
  async cancel(
    @Param('id') id: string,
    @CurrentPartner() partner: CurrentPartnerPayload,
  ): Promise<{ ok: true }> {
    await this.meetings.cancelScheduled(id, partner.id);
    return { ok: true };
  }
}
