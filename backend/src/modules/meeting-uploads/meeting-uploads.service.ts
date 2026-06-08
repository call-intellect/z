import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MeetingType, Prisma, type UploadSpeakerAssignment } from '@prisma/client';
import { ulid } from 'ulid';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import type { DialogTurn } from '../ai/services/prompts/common';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { MeetingsService } from '../meetings/meetings.service';
import { PersonsService } from '../persons/services/persons.service';
import { extractKeyFromUrl, transcriptMergedKey } from '../recordings/s3-keys';
import { S3Service } from '../recordings/s3.service';

import {
  fileExtension,
  UPLOAD_ALLOWED_EXTENSIONS,
  UPLOAD_MAX_SIZE_BYTES,
  type SpeakerAssignmentDto,
  type UploadCreateResultDto,
  type UploadPlaybackResultDto,
  type UploadSpeakerDto,
  type UploadSpeakersConfirmResultDto,
  type UploadSpeakersDraftResultDto,
  type UploadSpeakersResultDto,
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
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(PersonsService) private readonly persons: PersonsService,
    @Inject(AiQueueService) private readonly aiQueue: AiQueueService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  /**
   * Создаёт загруженную встречу и выдаёт presigned-PUT.
   * Валидация размера (Zod max) и расширения — до создания Meeting.
   */
  async createUpload(input: CreateUploadInput): Promise<UploadCreateResultDto> {
    // Аварийный рубильник (ТЗ-5 Ф6): если ручная загрузка выключена —
    // отклоняем создание до любых проверок/записи (диаризация/анализ уже
    // принятых загрузок не трогаются).
    await this.assertUploadEnabled();

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

  // ─────────────────────── Разметка спикеров (ТЗ-5 Ф4) ─────────────────────

  /**
   * `GET /meetings/:id/speakers` — спикеры диаризации + текущий транскрипт для
   * экрана ручной разметки. Доступно только в статусе `awaiting_speakers`
   * (после диаризации Ф3, до подтверждения). `MEETING_NOT_FOUND` —
   * нет/чужой tenant; `SPEAKERS_NOT_READY` — встреча не в `awaiting_speakers`.
   */
  async getSpeakers(
    meetingId: string,
    tenantId: string,
  ): Promise<UploadSpeakersResultDto> {
    const meeting = await this.findUploadMeeting(meetingId, tenantId);
    if (meeting.status !== 'awaiting_speakers') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'SPEAKERS_NOT_READY',
          message: 'Спикеры ещё не готовы к разметке',
        },
      });
    }

    const [rows, transcript] = await Promise.all([
      this.prisma.meetingUploadSpeaker.findMany({
        where: { meetingId },
        orderBy: { speakingSeconds: 'desc' },
      }),
      this.prisma.transcript.findUnique({
        where: { meetingId },
        select: { turns: true },
      }),
    ]);

    const turns = (transcript?.turns as unknown as DialogTurn[] | null) ?? [];
    return {
      speakers: rows.map((r) => this.toUploadSpeakerDto(r)),
      turns: turns.map((t) => ({
        speaker: t.speaker,
        text: t.text,
        startSec: t.startSec,
        endSec: t.endSec,
        speakerParticipantId: t.speakerParticipantId ?? null,
        speakerLivekitIdentity: t.speakerLivekitIdentity ?? null,
      })),
    };
  }

  /**
   * `PUT /meetings/:id/speakers` — сохранение черновика разметки (без запуска
   * анализа). Валидирует: встреча в `awaiting_speakers`; каждая метка
   * существует; для `employee` personId принадлежит tenant; отсутствие циклов
   * `mergedIntoLabel`. Upsert в `MeetingUploadSpeaker`.
   */
  async saveSpeakerDraft(
    meetingId: string,
    tenantId: string,
    assignments: SpeakerAssignmentDto[],
  ): Promise<UploadSpeakersDraftResultDto> {
    const meeting = await this.findUploadMeeting(meetingId, tenantId);
    this.assertAwaitingSpeakers(meeting.status);

    const rows = await this.prisma.meetingUploadSpeaker.findMany({
      where: { meetingId },
    });
    const byLabel = new Map(rows.map((r) => [r.label, r]));

    await this.validateAssignments(tenantId, assignments, byLabel);

    // `merged` нет в Prisma-enum `UploadSpeakerAssignment` (unassigned|employee|
    // external|excluded). Слияние моделируем через `mergedIntoLabel`, а в колонку
    // `assignment` пишем УНАСЛЕДОВАННОЕ от цели значение (см. ТЗ: «merged labels
    // inherit the target's assignment»). Резолвим по черновику с защитой от циклов.
    const draftByLabel = new Map(assignments.map((a) => [a.label, a]));
    const resolveDbAssignment = (
      label: string,
    ): UploadSpeakerAssignment => {
      const seen = new Set<string>();
      let cur = draftByLabel.get(label) ?? null;
      while (cur && cur.assignment === 'merged') {
        if (seen.has(cur.label)) return 'unassigned';
        seen.add(cur.label);
        cur = cur.mergedIntoLabel ? (draftByLabel.get(cur.mergedIntoLabel) ?? null) : null;
      }
      const eff = cur?.assignment;
      return eff === 'employee' || eff === 'external' || eff === 'excluded'
        ? eff
        : 'unassigned';
    };

    for (const a of assignments) {
      const dbAssignment =
        a.assignment === 'merged' ? resolveDbAssignment(a.label) : a.assignment;
      await this.prisma.meetingUploadSpeaker.update({
        where: { meetingId_label: { meetingId, label: a.label } },
        data: {
          assignment: dbAssignment,
          personId:
            a.assignment === 'employee' ? (a.personId ?? null) : null,
          externalName:
            a.assignment === 'external' ? (a.externalName ?? null) : null,
          externalCompany:
            a.assignment === 'external' ? (a.externalCompany ?? null) : null,
          externalPosition:
            a.assignment === 'external' ? (a.externalPosition ?? null) : null,
          mergedIntoLabel:
            a.assignment === 'merged' ? (a.mergedIntoLabel ?? null) : null,
        },
      });
    }

    const updated = await this.prisma.meetingUploadSpeaker.findMany({
      where: { meetingId },
      orderBy: { speakingSeconds: 'desc' },
    });
    return { speakers: updated.map((r) => this.toUploadSpeakerDto(r)) };
  }

  /**
   * `POST /meetings/:id/speakers/confirm` — снимает гейт: резолвит личности,
   * создаёт `Participant`, переразмечает транскрипт реальными именами и
   * запускает AI-анализ (`ai_processing`). Идемпотентно: если у спикера уже
   * есть `participantId` — переиспользуем, повторный confirm = no-op.
   *
   * Шаги (см. ТЗ-5 Ф4):
   *   1. Валидация: `awaiting_speakers`; каждый спикер с `speakingSeconds>0`
   *      имеет эффективное назначение ∈ {employee,external,excluded}; слитая
   *      метка (`mergedIntoLabel`!=null) наследует назначение цели (DB-enum не
   *      содержит `merged`).
   *   2. Резолв личностей: employee→personId; external→find-or-create Person;
   *      merged→та же личность что у цели; excluded→без личности.
   *   3. Создание `Participant(role=guest, livekitIdentity="upload:<label>")`
   *      по одной на финальную личность (merged → один Participant на обе метки).
   *   4. Переразметка `Transcript.turns`: speaker(displayLabel)→имя +
   *      speakerParticipantId; excluded → turn'ы удаляются; merged → обе метки
   *      становятся одним именем/участником. Перезапись turns + merged.json (S3).
   *   5. FSM `awaiting_speakers→ai_processing` + enqueue analyze/behavior/fast.
   */
  async confirmSpeakers(
    meetingId: string,
    tenantId: string,
  ): Promise<UploadSpeakersConfirmResultDto> {
    const meeting = await this.findUploadMeeting(meetingId, tenantId);
    this.assertAwaitingSpeakers(meeting.status);

    const rows = await this.prisma.meetingUploadSpeaker.findMany({
      where: { meetingId },
    });
    const byLabel = new Map(rows.map((r) => [r.label, r]));

    // 1. Эффективное назначение метки. Слитая метка (mergedIntoLabel!=null)
    //    наследует назначение цели (DB-enum не содержит `merged` — слияние
    //    моделируется полем `mergedIntoLabel`). Защита от циклов через `seen`.
    const resolveAssignment = (label: string): string | null => {
      const seen = new Set<string>();
      let r = byLabel.get(label);
      while (r && r.mergedIntoLabel) {
        if (seen.has(r.label)) return null;
        seen.add(r.label);
        r = byLabel.get(r.mergedIntoLabel);
      }
      return r ? r.assignment : null;
    };

    // Каждый спикер с речью должен быть размечен.
    for (const r of rows) {
      if (r.speakingSeconds <= 0) continue;
      const eff = resolveAssignment(r.label);
      if (
        eff !== 'employee' &&
        eff !== 'external' &&
        eff !== 'excluded'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'SPEAKERS_NOT_FULLY_ASSIGNED',
            message: 'Не все говорящие размечены. Назначьте каждого спикера.',
          },
        });
      }
    }

    // 2+3. Резолвим финальную личность и создаём Participant на каждую.
    //   Ключ финальной метки: следуем цепочкой mergedIntoLabel до конца.
    const finalLabelOf = (label: string): string => {
      const seen = new Set<string>();
      let r = byLabel.get(label);
      while (r && r.mergedIntoLabel) {
        if (seen.has(r.label)) break;
        seen.add(r.label);
        const next = byLabel.get(r.mergedIntoLabel);
        if (!next) break;
        r = next;
      }
      return r ? r.label : label;
    };

    // Карта finalLabel → { participantId, name }. Заполняется по мере создания.
    const finalParticipant = new Map<string, { id: string; name: string }>();
    // Карта label → итоговое { name, participantId | null } для переразметки.
    const turnTarget = new Map<
      string,
      { name: string; participantId: string | null; excluded: boolean }
    >();

    for (const r of rows) {
      const finalLabel = finalLabelOf(r.label);
      const head = byLabel.get(finalLabel);
      const eff = resolveAssignment(r.label);

      if (eff === 'excluded') {
        turnTarget.set(r.label, { name: '', participantId: null, excluded: true });
        continue;
      }
      if (!head) continue;

      // Создаём (или переиспользуем) Participant ровно по финальной метке.
      let participant = finalParticipant.get(finalLabel);
      if (!participant) {
        // Идемпотентность: если у head уже есть participantId — переиспользуем.
        if (head.participantId) {
          const existing = await this.prisma.participant.findUnique({
            where: { id: head.participantId },
            select: { id: true, name: true },
          });
          if (existing) {
            participant = { id: existing.id, name: existing.name };
            finalParticipant.set(finalLabel, participant);
          }
        }
        if (!participant) {
          const { id: personId, name } = await this.resolveIdentity(
            tenantId,
            head,
          );
          const created = await this.prisma.participant.create({
            data: {
              meetingId,
              livekitIdentity: `upload:${finalLabel}`,
              name,
              role: 'guest',
              personId,
            },
            select: { id: true, name: true },
          });
          participant = { id: created.id, name: created.name };
          finalParticipant.set(finalLabel, participant);
        }
      }

      turnTarget.set(r.label, {
        name: participant.name,
        participantId: participant.id,
        excluded: false,
      });
    }

    // Сохраняем participantId обратно на каждый MeetingUploadSpeaker (idempotency).
    for (const r of rows) {
      const finalLabel = finalLabelOf(r.label);
      const p = finalParticipant.get(finalLabel);
      const desired = p?.id ?? null;
      if (r.participantId !== desired) {
        await this.prisma.meetingUploadSpeaker.update({
          where: { meetingId_label: { meetingId, label: r.label } },
          data: { participantId: desired },
        });
      }
    }

    // 4. Переразметка транскрипта. turn.speaker хранит displayLabel («Человек N»),
    //    поэтому ключ маппинга — displayLabel метки.
    const byDisplay = new Map<
      string,
      { name: string; participantId: string | null; excluded: boolean }
    >();
    for (const r of rows) {
      const t = turnTarget.get(r.label);
      if (t) byDisplay.set(r.displayLabel, t);
    }

    const transcript = await this.prisma.transcript.findUnique({
      where: { meetingId },
      select: { turns: true },
    });
    const turns = (transcript?.turns as unknown as DialogTurn[] | null) ?? [];
    const relabeled: DialogTurn[] = [];
    for (const turn of turns) {
      const target = byDisplay.get(turn.speaker);
      if (target?.excluded) continue; // excluded → turn вырезается
      if (!target) {
        relabeled.push(turn); // нет маппинга (нет речи / без ряда) — оставляем как есть
        continue;
      }
      relabeled.push({
        ...turn,
        speaker: target.name,
        speakerParticipantId: target.participantId,
      });
    }

    const mergedKey = transcriptMergedKey(meetingId);
    await this.s3.putJson(mergedKey, { meetingId, turns: relabeled });
    await this.prisma.transcript.update({
      where: { meetingId },
      data: { turns: relabeled as unknown as Prisma.InputJsonValue },
    });

    // 5. FSM → ai_processing + запуск анализа (зеркало merge.worker:210-216).
    await this.meetings.transitionStatus(meetingId, 'ai_processing', {
      reason: 'upload_speakers_confirmed',
    });
    await this.aiQueue.enqueueAnalyze(meetingId);
    await this.aiQueue.enqueueBehaviorMetrics(meetingId);
    await this.maybeEnqueueMeetingReportFast(meetingId);

    this.logger.log(
      {
        meetingId,
        participants: finalParticipant.size,
        turnsBefore: turns.length,
        turnsAfter: relabeled.length,
      },
      'meeting-upload: спикеры подтверждены — встреча в ai_processing (analyze поставлен)',
    );
    return { status: 'ai_processing' };
  }

  // ─────────────────────── speaker helpers ──────────────────────────────────

  /** Находит upload-встречу в tenant'е или бросает `MEETING_NOT_FOUND`. */
  private async findUploadMeeting(
    meetingId: string,
    tenantId: string,
  ): Promise<{ id: string; status: string }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, tenantId: true, source: true, status: true },
    });
    if (
      !meeting ||
      meeting.tenantId !== tenantId ||
      meeting.source !== 'upload'
    ) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'MEETING_NOT_FOUND', message: 'Встреча не найдена' },
      });
    }
    return { id: meeting.id, status: meeting.status };
  }

  /** Гейт записи разметки: только из `awaiting_speakers`. */
  private assertAwaitingSpeakers(status: string): void {
    if (status !== 'awaiting_speakers') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'MEETING_NOT_AWAITING_SPEAKERS',
          message: 'Встреча не ожидает разметки спикеров',
        },
      });
    }
  }

  /**
   * Перекрёстная валидация черновика: метка существует, employee→personId в
   * tenant, отсутствие циклов merged. Бросает контрактные коды.
   */
  private async validateAssignments(
    tenantId: string,
    assignments: SpeakerAssignmentDto[],
    byLabel: Map<string, { label: string }>,
  ): Promise<void> {
    // 1. Метки существуют.
    for (const a of assignments) {
      if (!byLabel.has(a.label)) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'INVALID_SPEAKER_LABEL',
            message: `Метка говорящего «${a.label}» не найдена для встречи`,
          },
        });
      }
    }

    // 2. employee → personId принадлежит tenant'у.
    const employeePersonIds = assignments
      .filter((a) => a.assignment === 'employee')
      .map((a) => a.personId ?? null);
    if (employeePersonIds.some((id) => !id)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'INVALID_PERSON',
          message: 'Для сотрудника нужно выбрать карточку из компании',
        },
      });
    }
    const ids = [...new Set(employeePersonIds as string[])];
    if (ids.length > 0) {
      const found = await this.prisma.person.findMany({
        where: { id: { in: ids }, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'INVALID_PERSON', message: 'Сотрудник не найден в компании' },
        });
      }
    }

    // 3. merged → mergedIntoLabel задан, существует, не self, без циклов.
    const mergeMap = new Map<string, string>();
    for (const a of assignments) {
      if (a.assignment === 'merged') {
        if (!a.mergedIntoLabel || a.mergedIntoLabel === a.label) {
          throw new BadRequestException({
            ok: false,
            error: {
              code: 'INVALID_SPEAKER_LABEL',
              message: 'Слияние требует другую метку-цель',
            },
          });
        }
        if (!byLabel.has(a.mergedIntoLabel)) {
          throw new BadRequestException({
            ok: false,
            error: {
              code: 'INVALID_SPEAKER_LABEL',
              message: `Метка-цель слияния «${a.mergedIntoLabel}» не найдена`,
            },
          });
        }
        mergeMap.set(a.label, a.mergedIntoLabel);
      }
    }
    // Обнаружение циклов обходом цепочки merged.
    for (const start of mergeMap.keys()) {
      const seen = new Set<string>([start]);
      let cur = mergeMap.get(start);
      while (cur) {
        if (seen.has(cur)) {
          throw new BadRequestException({
            ok: false,
            error: {
              code: 'INVALID_SPEAKER_LABEL',
              message: 'Обнаружен цикл слияния меток',
            },
          });
        }
        seen.add(cur);
        cur = mergeMap.get(cur);
      }
    }
  }

  /**
   * Резолв финальной личности метки → `{ personId, name }`.
   *   - employee: используем personId, имя берём из Person;
   *   - external: find-or-create Person(relationship=external) по
   *     (tenant,name,company); имя = externalName.
   */
  private async resolveIdentity(
    tenantId: string,
    row: {
      assignment: string;
      personId: string | null;
      externalName: string | null;
      externalCompany: string | null;
      externalPosition: string | null;
      displayLabel: string;
    },
  ): Promise<{ id: string | null; name: string }> {
    if (row.assignment === 'employee' && row.personId) {
      const person = await this.prisma.person.findFirst({
        where: { id: row.personId, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!person) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'INVALID_PERSON', message: 'Сотрудник не найден в компании' },
        });
      }
      return { id: person.id, name: person.name || row.displayLabel };
    }
    if (row.assignment === 'external') {
      const name = (row.externalName ?? '').trim();
      if (!name) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'SPEAKERS_NOT_FULLY_ASSIGNED',
            message: 'У внешнего участника не указано имя',
          },
        });
      }
      const { id } = await this.persons.findOrCreateExternal({
        tenantId,
        name,
        company: row.externalCompany,
        jobTitle: row.externalPosition,
      });
      return { id, name };
    }
    // excluded или нерезолвимый — без личности.
    return { id: null, name: row.displayLabel };
  }

  /** Маппер ряда `MeetingUploadSpeaker` → DTO. */
  private toUploadSpeakerDto(r: {
    label: string;
    displayLabel: string;
    turnsCount: number;
    speakingSeconds: number;
    sampleText: string;
    assignment: UploadSpeakerDto['assignment'];
    personId: string | null;
    externalName: string | null;
    externalCompany: string | null;
    externalPosition: string | null;
    mergedIntoLabel: string | null;
    participantId: string | null;
  }): UploadSpeakerDto {
    return {
      label: r.label,
      displayLabel: r.displayLabel,
      turnsCount: r.turnsCount,
      speakingSeconds: r.speakingSeconds,
      sampleText: r.sampleText,
      assignment: r.assignment,
      personId: r.personId,
      externalName: r.externalName,
      externalCompany: r.externalCompany,
      externalPosition: r.externalPosition,
      mergedIntoLabel: r.mergedIntoLabel,
      participantId: r.participantId,
    };
  }

  /**
   * Постановка `core.meeting-report-fast` — зеркало `merge.worker`
   * `maybeEnqueueMeetingReportFast` (merge.worker.ts:295-327). Не валит confirm:
   * fast-отчёт вспомогательный, ошибки логируем и продолжаем.
   */
  private async maybeEnqueueMeetingReportFast(meetingId: string): Promise<void> {
    if (!this.cfg.knowledgeCore.meetingReportFastEnabled) {
      this.logger.log(
        { meetingId },
        'confirm: MEETING_REPORT_FAST_ENABLED=false — meeting-report-fast пропущен',
      );
      return;
    }
    try {
      await this.coreQueue.enqueueMeetingReportFast(meetingId);
    } catch (err) {
      this.logger.warn(
        { meetingId, err: err instanceof Error ? err.message : String(err) },
        'confirm: не удалось поставить core.meeting-report-fast (продолжаем без fast-отчёта)',
      );
    }
  }

  /**
   * Аварийный рубильник ручной загрузки (ТЗ-5 Ф6, Ship-On — ON по умолчанию).
   * Читаем AdminSetting `meeting_upload.enabled` (ENV-fallback
   * `MEETING_UPLOAD_ENABLED`, code-fallback true). При false → `UPLOAD_DISABLED`.
   * Тот же ключ доступен sync через `cfg.recording.meetingUploadEnabled`.
   */
  private async assertUploadEnabled(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'meeting_upload.enabled',
      'MEETING_UPLOAD_ENABLED',
      true,
    );
    if (!enabled) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'UPLOAD_DISABLED',
          message: 'Загрузка встреч временно недоступна. Попробуйте позже.',
        },
      });
    }
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
