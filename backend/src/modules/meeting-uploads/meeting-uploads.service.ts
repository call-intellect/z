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

const UPLOAD_PUT_TTL_SECONDS = 3600;

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

  async createUpload(input: CreateUploadInput): Promise<UploadCreateResultDto> {
    await this.assertUploadEnabled();

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
        ...(input.numSpeakersHint !== null ? { uploadNumSpeakersHint: input.numSpeakersHint } : {}),
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

  async completeUpload(meetingId: string, ownerId: string): Promise<{ status: string }> {
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

  async getPlayback(meetingId: string, ownerId: string): Promise<UploadPlaybackResultDto> {
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

    if (recording?.mainVideoUrl) {
      const key = extractKeyFromUrl(recording.mainVideoUrl, this.cfg.s3.bucket);
      const { url, expiresAt } = await this.s3.presignGet(key, undefined, {
        responseContentType: 'video/mp4',
        responseContentDisposition: 'inline',
      });
      return { kind: 'video', url, expiresAt: expiresAt.toISOString() };
    }

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

  async getSpeakers(meetingId: string, tenantId: string): Promise<UploadSpeakersResultDto> {
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

    const draftByLabel = new Map(assignments.map((a) => [a.label, a]));
    const resolveDbAssignment = (label: string): UploadSpeakerAssignment => {
      const seen = new Set<string>();
      let cur = draftByLabel.get(label) ?? null;
      while (cur && cur.assignment === 'merged') {
        if (seen.has(cur.label)) return 'unassigned';
        seen.add(cur.label);
        cur = cur.mergedIntoLabel ? (draftByLabel.get(cur.mergedIntoLabel) ?? null) : null;
      }
      const eff = cur?.assignment;
      return eff === 'employee' || eff === 'external' || eff === 'excluded' ? eff : 'unassigned';
    };

    for (const a of assignments) {
      const dbAssignment = a.assignment === 'merged' ? resolveDbAssignment(a.label) : a.assignment;
      await this.prisma.meetingUploadSpeaker.update({
        where: { meetingId_label: { meetingId, label: a.label } },
        data: {
          assignment: dbAssignment,
          personId: a.assignment === 'employee' ? (a.personId ?? null) : null,
          externalName: a.assignment === 'external' ? (a.externalName ?? null) : null,
          externalCompany: a.assignment === 'external' ? (a.externalCompany ?? null) : null,
          externalPosition: a.assignment === 'external' ? (a.externalPosition ?? null) : null,
          mergedIntoLabel: a.assignment === 'merged' ? (a.mergedIntoLabel ?? null) : null,
        },
      });
    }

    const updated = await this.prisma.meetingUploadSpeaker.findMany({
      where: { meetingId },
      orderBy: { speakingSeconds: 'desc' },
    });
    return { speakers: updated.map((r) => this.toUploadSpeakerDto(r)) };
  }

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

    for (const r of rows) {
      if (r.speakingSeconds <= 0) continue;
      const eff = resolveAssignment(r.label);
      if (eff !== 'employee' && eff !== 'external' && eff !== 'excluded') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'SPEAKERS_NOT_FULLY_ASSIGNED',
            message: 'Не все говорящие размечены. Назначьте каждого спикера.',
          },
        });
      }
    }

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

    const finalParticipant = new Map<string, { id: string; name: string }>();
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

      let participant = finalParticipant.get(finalLabel);
      if (!participant) {
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
          const { id: personId, name } = await this.resolveIdentity(tenantId, head);
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
      if (target?.excluded) continue;
      if (!target) {
        relabeled.push(turn);
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

  private async findUploadMeeting(
    meetingId: string,
    tenantId: string,
  ): Promise<{ id: string; status: string }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, tenantId: true, source: true, status: true },
    });
    if (!meeting || meeting.tenantId !== tenantId || meeting.source !== 'upload') {
      throw new NotFoundException({
        ok: false,
        error: { code: 'MEETING_NOT_FOUND', message: 'Встреча не найдена' },
      });
    }
    return { id: meeting.id, status: meeting.status };
  }

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

  private async validateAssignments(
    tenantId: string,
    assignments: SpeakerAssignmentDto[],
    byLabel: Map<string, { label: string }>,
  ): Promise<void> {
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
    return { id: null, name: row.displayLabel };
  }

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

  private async assertQuota(tenantId: string): Promise<void> {
    const limit = await this.cfg.getDynamic<number>(
      'billing.meetingUploadsPerMonth',
      'BILLING_MEETING_UPLOADS_PER_MONTH',
      DEFAULT_UPLOADS_PER_MONTH,
    );
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
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
