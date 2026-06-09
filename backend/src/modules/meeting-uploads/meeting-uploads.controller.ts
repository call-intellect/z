import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireEntitlement } from '../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  SpeakerAssignmentsSchema,
  UploadCreateSchema,
  type SpeakerAssignmentsDto,
  type UploadCreateDto,
  type UploadCreateResultDto,
  type UploadCompleteResultDto,
  type UploadPlaybackResultDto,
  type UploadSpeakersConfirmResultDto,
  type UploadSpeakersDraftResultDto,
  type UploadSpeakersResultDto,
} from './dto/meeting-uploads.dto';
import { MeetingUploadsService } from './meeting-uploads.service';

/**
 * Контроллер ручной загрузки встреч (ТЗ-5 Ф2).
 *
 * Защита: `CookieAuthGuard + TenantGuard` + `@RequireEntitlement('feature.meeting')`
 * (фича доступна на тарифе со встречами). Запись (создание/завершение загрузки) —
 * RBAC write по ресурсу `meeting` (owner/admin; manager — own). tenantId берётся
 * из `X-Org-Id`/`:orgId` через `@CurrentOrg`.
 *
 * Маршруты живут под `/api/v1/meetings`, но в отдельном контроллере — чтобы не
 * раздувать живой `MeetingsController` (NestJS допускает несколько контроллеров
 * на один префикс; пути не пересекаются с существующими).
 *
 * Эндпоинты:
 *   - `POST /meetings/upload`              — создать загруженную встречу + presigned PUT.
 *   - `POST /meetings/:id/upload/complete` — файл залит → запустить ingest.
 *   - `GET  /meetings/:id/upload/playback` — источник медиа для плеера.
 */
@ApiTags('meeting-uploads')
@Controller('api/v1/meetings')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.meeting')
export class MeetingUploadsController {
  constructor(
    @Inject(MeetingUploadsService) private readonly uploads: MeetingUploadsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Создать загруженную встречу (видео/аудио любого формата ≤2 ГБ) и получить presigned-PUT для прямой загрузки файла в S3.',
  })
  async createUpload(
    @Body(new ZodValidationPipe(UploadCreateSchema)) body: UploadCreateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UploadCreateResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);

    return this.uploads.createUpload({
      tenantId: t,
      ownerId: user.id,
      type: body.type,
      title: body.title,
      customPrompt: body.customPrompt ?? null,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      numSpeakersHint: body.numSpeakersHint ?? null,
    });
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Завершить загрузку (файл уже залит в S3) — запускает обработку медиа.',
  })
  async completeUpload(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UploadCompleteResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.uploads.completeUpload(id, user.id);
  }

  @Get(':id/upload/playback')
  @ApiOperation({
    summary:
      'Источник медиа для плеера: нативное mp4-видео или нормализованное аудио (presigned).',
  })
  async getPlayback(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UploadPlaybackResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.uploads.getPlayback(id, user.id);
  }

  // ─────────────────────── Разметка спикеров (ТЗ-5 Ф4) ─────────────────────

  @Get(':id/speakers')
  @ApiOperation({
    summary:
      'Спикеры диаризации загруженной встречи + транскрипт для ручной разметки (только в статусе awaiting_speakers).',
  })
  async getSpeakers(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UploadSpeakersResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.uploads.getSpeakers(id, t);
  }

  @Put(':id/speakers')
  @ApiOperation({
    summary:
      'Сохранить черновик разметки спикеров (назначение метки: сотрудник / внешний / исключить / слить). Анализ не запускается.',
  })
  async saveSpeakerDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SpeakerAssignmentsSchema))
    body: SpeakerAssignmentsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UploadSpeakersDraftResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.uploads.saveSpeakerDraft(id, t, body.assignments);
  }

  @Post(':id/speakers/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Подтвердить разметку спикеров — создаёт участников, переразмечает транскрипт реальными именами и запускает AI-анализ. Идемпотентно.',
  })
  async confirmSpeakers(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UploadSpeakersConfirmResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.uploads.confirmSpeakers(id, t);
  }

  // ─────────────────────────── helpers ───────────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'meeting');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для загрузки встреч' },
      });
    }
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'meeting');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для просмотра встречи' },
      });
    }
  }
}
