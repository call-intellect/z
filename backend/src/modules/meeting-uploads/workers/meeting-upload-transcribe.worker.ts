import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type { DialogTurn } from '../../ai/services/prompts/common';
import { VoxService } from '../../ai/services/vox.service';
import type { VoxDiarizedSegment } from '../../ai/services/vox.types';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { MeetingsService } from '../../meetings/meetings.service';
import { transcriptMergedKey } from '../../recordings/s3-keys';
import { S3Service } from '../../recordings/s3.service';
import { uploadAudioKey, uploadAudioWavKey } from '../meeting-upload-keys';
import {
  MEETING_UPLOAD_QUEUE_NAMES,
  type MeetingUploadJobData,
} from '../meeting-uploads.queues';

/**
 * Worker очереди `meeting.upload-transcribe` (ТЗ-5 Ф3, meeting-upload-diarization).
 *
 * Берёт ОДНО смешанное аудио загруженной встречи (`audio.ogg`, fallback `.wav`),
 * прогоняет через Vox с диаризацией (`diarizationEnabled:true`) и:
 *   1. Строит `DialogTurn[]` — по одному turn на сегмент диаризации
 *      (`speaker = «Человек N»`, `startSec/endSec` в СЕКУНДАХ напрямую из
 *      `VoxDiarizedSegment`). Сохраняет в `Transcript` (+ зеркало merged.json в
 *      S3 по образцу `MergeWorker`).
 *   2. Строит `MeetingUploadSpeaker[]` — по одному ряду на метку говорящего
 *      (`"SPEAKER N"`): turnsCount, speakingSeconds, sampleText (самый длинный
 *      сегмент). Upsert по `@@unique([meetingId, label])` — идемпотентно.
 *   3. FSM `recording_ready → transcription_processing → awaiting_speakers`.
 *
 * **ГЕЙТ:** анализ (analyze/behavior/report-fast) НЕ ставится — встреча ждёт
 * ручной разметки спикеров (`/speakers/confirm`, Ф4), только после неё уходит
 * в `ai_processing`. Это принципиальное отличие от живого per-track конвейера.
 *
 * Идемпотентность: фиксированный jobId `meeting_upload_transcribe_<meetingId>`
 * + FSM-guard (повторный запуск на уже размеченной встрече — no-op). Сама
 * Vox-задача переиспользуется через polling того же taskId не нужна: upload —
 * одно аудио, повторный submit при ретрае допустим (идемпотентность результата
 * обеспечивается upsert'ом Transcript/Speaker).
 *
 * Concurrency=1 — одно тяжёлое аудио на встречу, не частим Vox.
 */
@Injectable()
export class MeetingUploadTranscribeWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MeetingUploadTranscribeWorker.name);
  private worker: Worker<MeetingUploadJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VoxService) private readonly vox: VoxService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MeetingUploadJobData>(
      MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_TRANSCRIBE,
      async (job: Job<MeetingUploadJobData>) =>
        this.pipe.meeting(
          SystemLogPipeline.TRANSCRIPTION,
          'meeting.upload-transcribe',
          job.data.meetingId,
          () => this.processMeeting(job.data.meetingId),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.logger.debug(
      `MeetingUploadTranscribeWorker запущен (${MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_TRANSCRIBE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Обработка одной загруженной встречи. Публичный — для прямого вызова в
   * тестах. Идемпотентна (FSM-guard + фиксированный jobId).
   */
  async processMeeting(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        source: true,
        status: true,
        uploadNumSpeakersHint: true,
      },
    });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'upload-transcribe: встреча не найдена — skip');
      return;
    }
    if (meeting.source !== 'upload') {
      this.logger.warn({ meetingId }, 'upload-transcribe: не upload-встреча — skip');
      return;
    }
    // FSM-guard идемпотентности: transcribe имеет смысл только из
    // `recording_ready` (ingest завершён) или `transcription_processing`
    // (ретрай после старта). Уже в `awaiting_speakers`/дальше → повтор no-op.
    if (
      meeting.status !== 'recording_ready' &&
      meeting.status !== 'transcription_processing'
    ) {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'upload-transcribe: статус не recording_ready/transcription_processing — повтор no-op',
      );
      return;
    }

    if (meeting.status === 'recording_ready') {
      await this.meetings.transitionStatus(meetingId, 'transcription_processing', {
        reason: 'upload_transcribe_start',
      });
    }

    // 1. Читаем нормализованное аудио (opus → fallback wav).
    const audio = await this.loadAudio(meetingId);

    // 2. Vox submit + poll с диаризацией. Submit/poll переиспользуем как
    //    живой per-track путь, но с diarizationEnabled:true и numSpeakers из
    //    подсказки (если задана). Одно аудио — submit без сохранённого taskId.
    const submitted = await this.vox.submit(audio, {
      diarizationEnabled: true,
      ...(meeting.uploadNumSpeakersHint != null
        ? { numSpeakers: meeting.uploadNumSpeakersHint }
        : {}),
    });
    this.logger.debug(
      { meetingId, taskId: submitted.taskId },
      'upload-transcribe: Vox задача принята — ожидаем результат',
    );
    const voxResult = await this.vox.poll(submitted.taskId, {
      intervalMs: this.cfg.ai.vox.pollIntervalMs,
      maxAttempts: this.cfg.ai.vox.pollMaxAttempts,
    });

    const segments = voxResult.segments ?? [];
    this.logger.debug(
      {
        meetingId,
        segmentsCount: segments.length,
        durationSeconds: voxResult.durationSeconds,
        textLength: voxResult.transcriptText.length,
      },
      'upload-transcribe: Vox диаризация получена',
    );

    // 3. DialogTurn[] — по одному turn на сегмент. startSec/endSec — СЕКУНДЫ
    //    из VoxDiarizedSegment напрямую (без конвертации). speaker = displayLabel
    //    «Человек N» (то, что увидит пользователь до ручной разметки).
    const turns: DialogTurn[] = segments.map((seg) => ({
      speaker: displayLabel(seg.speakerId),
      text: seg.text,
      startSec: seg.startSec,
      endSec: seg.endSec,
      speakerParticipantId: null,
      speakerLivekitIdentity: null,
    }));

    const totalWords = countWordsInTurns(turns);
    const totalDurationSeconds = Math.round(voxResult.durationSeconds);

    // 4. Сохраняем Transcript + зеркалим merged.json в S3 (как MergeWorker).
    //    upsert — идемпотентно при ретрае.
    const mergedKey = transcriptMergedKey(meetingId);
    await this.s3.putJson(mergedKey, { meetingId, turns });
    await this.prisma.transcript.upsert({
      where: { meetingId },
      create: {
        meetingId,
        turns: turns as unknown as Prisma.InputJsonValue,
        totalWords,
        totalDurationSeconds,
        mergedS3Url: mergedKey,
      },
      update: {
        turns: turns as unknown as Prisma.InputJsonValue,
        totalWords,
        totalDurationSeconds,
        mergedS3Url: mergedKey,
      },
    });

    // 5. MeetingUploadSpeaker[] — группировка сегментов по метке говорящего.
    const speakers = buildUploadSpeakers(segments);
    for (const sp of speakers) {
      await this.prisma.meetingUploadSpeaker.upsert({
        where: { meetingId_label: { meetingId, label: sp.label } },
        create: {
          meetingId,
          label: sp.label,
          displayLabel: sp.displayLabel,
          turnsCount: sp.turnsCount,
          speakingSeconds: sp.speakingSeconds,
          sampleText: sp.sampleText,
        },
        update: {
          displayLabel: sp.displayLabel,
          turnsCount: sp.turnsCount,
          speakingSeconds: sp.speakingSeconds,
          sampleText: sp.sampleText,
        },
      });
    }

    // 6. FSM → awaiting_speakers. ГЕЙТ: анализ НЕ ставим — ждём ручной разметки
    //    спикеров (Ф4 `/speakers/confirm` поставит ai_processing).
    await this.meetings.transitionStatus(meetingId, 'awaiting_speakers', {
      reason: 'upload_transcribe_done',
    });

    this.logger.debug(
      {
        meetingId,
        turns: turns.length,
        speakers: speakers.length,
        totalWords,
        totalDurationSeconds,
      },
      'upload-transcribe: диаризация готова — встреча в awaiting_speakers (ждёт разметки спикеров)',
    );
  }

  /**
   * Читает нормализованное аудио из S3: сначала `audio.ogg` (opus), при
   * отсутствии — `audio.wav` (fallback PCM, см. ingest-воркер). Бросает, если
   * ни одного нет (тогда BullMQ ретраит).
   */
  private async loadAudio(meetingId: string): Promise<Buffer> {
    const oggKey = uploadAudioKey(meetingId);
    try {
      return await this.s3.getObject(oggKey);
    } catch (errOgg) {
      this.logger.debug(
        { meetingId, oggKey, err: errOgg instanceof Error ? errOgg.message : String(errOgg) },
        'upload-transcribe: audio.ogg не найден — пробуем audio.wav',
      );
      const wavKey = uploadAudioWavKey(meetingId);
      return this.s3.getObject(wavKey);
    }
  }
}

// ─────────────────────────── helpers ───────────────────────────────────────

/** Человеко-читаемая метка говорящего до ручной разметки: «Человек N». */
function displayLabel(speakerId: number): string {
  return `«Человек ${speakerId}»`;
}

/** Число слов во всех turn'ах (split по whitespace, как merger.countWords). */
function countWordsInTurns(turns: DialogTurn[]): number {
  return turns.reduce(
    (sum, t) => sum + (t.text === '' ? 0 : t.text.split(/\s+/).filter(Boolean).length),
    0,
  );
}

interface UploadSpeakerRow {
  label: string;
  displayLabel: string;
  turnsCount: number;
  speakingSeconds: number;
  sampleText: string;
}

/**
 * Группирует сегменты диаризации по метке говорящего (`"SPEAKER N"`) и считает
 * для каждого: turnsCount (число сегментов), speakingSeconds (сумма end-start,
 * округлённая), sampleText (текст самого длинного сегмента).
 */
function buildUploadSpeakers(segments: VoxDiarizedSegment[]): UploadSpeakerRow[] {
  const byLabel = new Map<
    string,
    {
      speakerId: number;
      turnsCount: number;
      speakingSeconds: number;
      sampleText: string;
      sampleLen: number;
    }
  >();

  for (const seg of segments) {
    const label = seg.speaker || `SPEAKER ${seg.speakerId}`;
    const durSec = Math.max(0, seg.endSec - seg.startSec);
    const existing = byLabel.get(label);
    if (!existing) {
      byLabel.set(label, {
        speakerId: seg.speakerId,
        turnsCount: 1,
        speakingSeconds: durSec,
        sampleText: seg.text,
        sampleLen: seg.text.length,
      });
      continue;
    }
    existing.turnsCount += 1;
    existing.speakingSeconds += durSec;
    if (seg.text.length > existing.sampleLen) {
      existing.sampleText = seg.text;
      existing.sampleLen = seg.text.length;
    }
  }

  return [...byLabel.entries()].map(([label, v]) => ({
    label,
    displayLabel: displayLabel(v.speakerId),
    turnsCount: v.turnsCount,
    speakingSeconds: Math.round(v.speakingSeconds),
    sampleText: v.sampleText,
  }));
}
