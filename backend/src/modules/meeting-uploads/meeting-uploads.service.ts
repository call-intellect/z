import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MeetingType } from '@prisma/client';
import { ulid } from 'ulid';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { extractKeyFromUrl } from '../recordings/s3-keys';
import { S3Service } from '../recordings/s3.service';

import {
  fileExtension,
  UPLOAD_ALLOWED_EXTENSIONS,
  UPLOAD_MAX_SIZE_BYTES,
  type UploadCreateResultDto,
  type UploadPlaybackResultDto,
} from './dto/meeting-uploads.dto';
import { uploadAudioKey, uploadSourceKey } from './meeting-upload-keys';
import { MeetingUploadsQueueService } from './meeting-uploads-queue.service';

/** TTL presigned-PUT — 1 час (хватает залить файл до 2 ГБ). */
const UPLOAD_PUT_TTL_SECONDS = 3600;

/** Дефолт лимита загрузок/мес на Org (Р5; редактируется в админке — Ф6). */
const DEFAULT_UPLOADS_PER_MONTH = 20;

interface CreateUploadInput {
  tenantId: string;
  ownerId: string;
  type: MeetingType;
  title: string;
  customPrompt: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  numSpeakersHint: number | null;
}

/**
 * Сервис ручной загрузки встреч (ТЗ-5 Ф2). Отвечает за:
 *   - создание `Meeting(source=upload, status=scheduled)`;
 *   - проверку лимита загрузок/мес (Р5, отдельно от `MeetingsBalance`);
 *   - выдачу presigned-PUT для прямой загрузки файла в S3 (≤2 ГБ, Р4);
 *   - постановку ingest-job по `/upload/complete`;
 *   - presigned-плеер (`/upload/playback`): нативное mp4-видео или
 *     нормализованное аудио.
 *
 * Ошибки бросаются как Nest-исключения с телом `{ ok:false, error:{code,message} }`
 * (единый формат API Z; коды совпадают с контрактом ТЗ).
 */
@Injectable()
export class MeetingUploadsService {
  private readonly logger = new Logger(MeetingUploadsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MeetingUploadsQueueService)
    private readonly queue: MeetingUploadsQueueService,
  ) {}

  /**
   * Создаёт загруженную встречу и выдаёт presigned-PUT.
   * Валидация размера (Zod max) и расширения — до создания Meeting.
   */
  async createUpload(input: CreateUploadInput): Promise<UploadCreateResultDto> {
    // Размер: Zod-схема (`.max`) — первая линия; здесь дублируем с контрактным
    // кодом `UPLOAD_FILE_TOO_LARGE` (Zod-пайп отдал бы общий `validation_error`).
    if (input.sizeBytes > UPLOAD_MAX_SIZE_BYTES) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'UPLOAD_FILE_TOO_LARGE',
          message: 'Файл больше 2 ГБ. Загрузите файл меньшего размера.',
        },
      });
    }

    const ext = fileExtension(input.fileName);
    if (!ext || !UPLOAD_ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'UPLOAD_UNSUPPORTED_FORMAT',
          message: 'Этот формат файла не поддерживается. Загрузите видео или аудио.',
        },
      });
    }

    await this.assertQuota(input.tenantId);

    const meetingId = ulid();
    await this.prisma.meeting.create({
      data: {
        id: meetingId,
        roomName: meetingId,
        title: input.title,
        type: input.type,
        ownerId: input.ownerId,
        tenantId: input.tenantId,
        customPrompt: input.customPrompt,
        recordByDefault: true,
        status: 'scheduled',
        source: 'upload',
        ...(input.numSpeakersHint !== null
          ? { uploadNumSpeakersHint: input.numSpeakersHint }
          : {}),
      },
    });

    const uploadKey = uploadSourceKey(meetingId, ext);
    const uploadUrl = await this.s3.presignPut(
      uploadKey,
      input.contentType,
      UPLOAD_PUT_TTL_SECONDS,
    );
    const expiresAt = new Date(Date.now() + UPLOAD_PUT_TTL_SECONDS * 1000);

    this.logger.log(
      { meetingId, tenantId: input.tenantId, ext, sizeBytes: input.sizeBytes },
      'meeting-upload: создана загруженная встреча + presigned PUT',
    );

    return {
      meetingId,
      uploadUrl,
      uploadKey,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Завершение загрузки — клиент залил файл в S3 и зовёт этот endpoint.
   * Валидирует, что встреча — upload + scheduled, ставит ingest-job.
   * Идемпотентно: повторный вызов = no-op enqueue (тот же jobId).
   */
  async completeUpload(
    meetingId: string,
    ownerId: string,
  ): Promise<{ status: string }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, ownerId: true, source: true, status: true },
    });
    if (!meeting || meeting.ownerId !== ownerId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'MEETING_NOT_FOUND', message: 'Встреча не найдена' },
      });
    }
    if (meeting.source !== 'upload' || meeting.status !== 'scheduled') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'UPLOAD_NOT_PENDING',
          message: 'Загрузка уже обрабатывается или не ожидает завершения',
        },
      });
    }

    await this.queue.enqueueUploadIngest(meetingId);
    this.logger.log({ meetingId }, 'meeting-upload: complete → ingest поставлен');
    return { status: 'processing' };
  }

  /**
   * Источник медиа для плеера результата:
   *   - нативное mp4-видео (faststart-ремукс из ingest) → `kind:'video'`;
   *   - иначе нормализованное аудио → `kind:'audio'`.
   * `MEDIA_NOT_READY` — пока ingest не подготовил ни видео, ни аудио.
   */
  async getPlayback(
    meetingId: string,
    ownerId: string,
  ): Promise<UploadPlaybackResultDto> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, ownerId: true },
    });
    if (!meeting || meeting.ownerId !== ownerId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'MEETING_NOT_FOUND', message: 'Встреча не найдена' },
      });
    }

    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      select: { mainVideoUrl: true },
    });

    // Нативное видео: faststart-ремукс записал mainVideoUrl (h264+aac mp4).
    if (recording?.mainVideoUrl) {
      const key = extractKeyFromUrl(recording.mainVideoUrl, this.cfg.s3.bucket);
      const { url, expiresAt } = await this.s3.presignGet(key, undefined, {
        responseContentType: 'video/mp4',
        responseContentDisposition: 'inline',
      });
      return { kind: 'video', url, expiresAt: expiresAt.toISOString() };
    }

    // Аудио: нормализованный объект из ingest. Проверяем наличие листингом
    // префикса (ext может быть .ogg или .wav-fallback).
    const audioKey = uploadAudioKey(meetingId);
    const keys = await this.s3.listKeys(`meetings/${meetingId}/upload/audio`);
    const resolved = keys.includes(audioKey) ? audioKey : keys[0];
    if (!resolved) {
      throw new ConflictException({
        ok: false,
        error: { code: 'MEDIA_NOT_READY', message: 'Медиа ещё обрабатывается' },
      });
    }
    const { url, expiresAt } = await this.s3.presignGet(resolved, undefined, {
      responseContentDisposition: 'inline',
    });
    return { kind: 'audio', url, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Лимит загрузок/мес (Р5). Считаем `Meeting` с `source=upload`,
   * `deletedAt=null`, `createdAt` в текущем календарном месяце (UTC). Лимит —
   * AdminSetting `billing.meetingUploadsPerMonth` (ENV-fallback
   * `BILLING_MEETING_UPLOADS_PER_MONTH`, code-fallback 20). >= лимита →
   * `UPLOAD_QUOTA_EXCEEDED`.
   */
  private async assertQuota(tenantId: string): Promise<void> {
    const limit = await this.cfg.getDynamic<number>(
      'billing.meetingUploadsPerMonth',
      'BILLING_MEETING_UPLOADS_PER_MONTH',
      DEFAULT_UPLOADS_PER_MONTH,
    );
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    const count = await this.prisma.meeting.count({
      where: {
        tenantId,
        source: 'upload',
        deletedAt: null,
        createdAt: { gte: monthStart },
      },
    });
    if (count >= limit) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'UPLOAD_QUOTA_EXCEEDED',
          message: `Достигнут месячный лимит загрузок (${limit}). Обратитесь к администратору.`,
        },
      });
    }
  }
}
