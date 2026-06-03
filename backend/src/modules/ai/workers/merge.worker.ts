import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { transcriptMergedKey } from '../../recordings/s3-keys';
import { S3Service } from '../../recordings/s3.service';
import { AiQueueService } from '../ai-queue.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';
import {
  countWords,
  loadRoomChatForMerge,
  maxEndSec,
  mergeWordTimestamps,
  type PerTrackWords,
} from '../services/merger';
import type { DialogTurn, RoomChatMessage } from '../services/prompts/common';

/**
 * Worker стадии `ai.merge`.
 *
 *   1. Читает TranscriptTrack-и из БД (word-timestamps на трек).
 *   2. Склеивает в единый dialog: DialogTurn[].
 *   3. Сохраняет turns/roomChat/totalWords/totalDurationSeconds в Transcript (БД).
 *   4. transitionStatus → transcription_ready.
 *   5. enqueueAnalyze(meetingId).
 *
 * Идемпотентность: если Transcript.turns уже заполнен — сразу к analyze.
 */
@Injectable()
export class MergeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeWorker.name);
  private worker: Worker<AiJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(S3Service) private readonly s3: S3Service,
    // ТЗ 2026-05-25, Фаза 4 — producer для новой цепочки `meeting-report-fast`.
    // Optional, чтобы спеки/тесты могли создавать worker без core-queue
    // (legacy ai-pipeline останется работать).
    @Optional()
    @Inject(CoreQueueService)
    private readonly coreQueue?: CoreQueueService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.MERGE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(`onJobFailed: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    this.logger.log(`MergeWorker запущен (${QUEUE_NAMES.MERGE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── core ────────────────────────────────────────

  private async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    const startedAt = Date.now();

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcript: { include: { tracks: true } } },
    });

    if (!meeting?.transcript || meeting.transcript.tracks.length === 0) {
      this.logger.warn({ meetingId }, 'merge: нет TranscriptTrack-ов в БД');
      return;
    }
    if (
      meeting.status !== 'transcription_processing' &&
      meeting.status !== 'transcription_ready'
    ) {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'merge: статус не transcription_processing/ready — пропуск',
      );
      return;
    }

    // Идемпотентность: turns уже склеены — сразу к analyze.
    if (meeting.transcript.turns !== null) {
      this.logger.log({ meetingId }, 'merge: turns уже в БД — analyze');
      // Бэкафилл merged.json для встреч, смерженных до появления S3-зеркала:
      // без `mergedS3Url` behavior-metrics/quality-score/custom-report
      // пропускаются («нет merged.json»).
      await this.ensureMergedJsonMirror(meetingId, meeting.transcript);
      await this.queue.enqueueAnalyze(meetingId);
      // Фаза B — параллельно с analyze. Идемпотентность через jobId.
      await this.queue.enqueueBehaviorMetrics(meetingId);
      // ТЗ 2026-05-25, Фаза 4 — параллельный producer meeting-report-fast.
      await this.maybeEnqueueMeetingReportFast(meetingId);
      return;
    }

    // 1. Строим perTrack из DB-треков.
    const perTrack: PerTrackWords[] = meeting.transcript.tracks.map((track) => {
      const rawWords = (track.words ?? []) as Array<{ word: string; startMs: number; endMs: number }>;
      // Если words пустой, но есть transcriptText — fallback: один псевдо-word.
      const effectiveWords =
        rawWords.length > 0
          ? rawWords
          : track.transcriptText.trim().length > 0
            ? [{ word: track.transcriptText, startMs: 0, endMs: 0 }]
            : [];
      return {
        speakerName: track.speakerName,
        words: effectiveWords,
        trackStartedAt: track.trackStartedAt,
        baseStartedAt: track.baseStartedAt,
      };
    });

    // 2. Склейка.
    const dialog: DialogTurn[] = mergeWordTimestamps(perTrack);
    const totalWords = countWords(dialog);
    const totalDurationSeconds = maxEndSec(dialog);

    // 3. Подмешиваем in-meeting чат (опционально, по флагу INCLUDE_ROOM_CHAT_IN_AI).
    const roomChat: RoomChatMessage[] | null = await loadRoomChatForMerge({
      prisma: this.prisma,
      cfg: this.cfg,
      meetingId,
    });

    // 4. Сохраняем в Transcript (БД) + зеркалим merged.json в S3.
    //    Источник правды для отображения — колонка `turns`. merged.json в S3
    //    нужен AI-воркерам, читающим транскрипт по `mergedS3Url`
    //    (behavior-metrics, quality-score, custom-report, transcript-clean).
    const mergedKey = transcriptMergedKey(meetingId);
    await this.s3.putJson(mergedKey, { meetingId, turns: dialog });
    await this.prisma.transcript.update({
      where: { meetingId },
      data: {
        turns: dialog as unknown as Prisma.InputJsonValue,
        roomChat: roomChat !== null ? (roomChat as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        totalWords,
        totalDurationSeconds,
        mergedS3Url: mergedKey,
      },
    });

    // 5. FSM → transcription_ready (если ещё в processing).
    if (meeting.status === 'transcription_processing') {
      await this.meetings.transitionStatus(meetingId, 'transcription_ready', {
        reason: 'ai:merge:done',
      });
    }

    // 6. Метрика и enqueue.
    this.metrics.observeAiPipelineDuration({
      stage: 'merge',
      type: meeting.type,
      model: 'merger',
      seconds: (Date.now() - startedAt) / 1000,
    });

    await this.queue.enqueueAnalyze(meetingId);
    // Фаза B — поведенческие метрики параллельно с analyze (не блокирует).
    await this.queue.enqueueBehaviorMetrics(meetingId);
    // ТЗ 2026-05-25, Фаза 4 — параллельный producer meeting-report-fast.
    // Старая цепочка `ai.analyze` (и/или `core.meeting-analyze-v2`) не
    // ломается — новая запускается рядом для A/B-сравнения.
    await this.maybeEnqueueMeetingReportFast(meetingId);

    // Фаза D — опционально ставим очистку транскрипта.
    // Включается через `Org.transcriptCleaningAuto`. Если выключено — Org
    // может запустить вручную через `POST /meetings/:id/transcript/clean`.
    // Cleaning независим от AI-pipeline: ошибки воркера ai.transcript-clean
    // НЕ влияют на ai.analyze / ai.chapters / ai.tasks (см. зонтик Q8).
    let cleaningEnqueued = false;
    try {
      if (meeting.tenantId) {
        const org = await this.prisma.org.findUnique({
          where: { id: meeting.tenantId },
          select: { transcriptCleaningAuto: true },
        });
        if (org?.transcriptCleaningAuto === true) {
          await this.queue.enqueueTranscriptClean(meetingId);
          cleaningEnqueued = true;
        }
      }
    } catch (err) {
      // Не валим merge — это вспомогательный путь. Логируем и продолжаем.
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'merge: не удалось поставить ai.transcript-clean (продолжаем без cleaning)',
      );
    }

    this.logger.log(
      {
        meetingId,
        totalWords,
        totalDurationSeconds,
        roomChatCount: roomChat?.length ?? 0,
        cleaningEnqueued,
      },
      'merge: успешно — analyze + behavior-metrics поставлены',
    );
  }

  /**
   * Гарантирует наличие merged.json в S3 и проставленный `Transcript.mergedS3Url`.
   * No-op, если `mergedS3Url` уже задан. Нужен на идемпотентном пути и для встреч,
   * смерженных до появления S3-зеркала (иначе зависимые AI-воркеры пропускаются).
   */
  private async ensureMergedJsonMirror(
    meetingId: string,
    transcript: { turns: unknown; mergedS3Url: string | null },
  ): Promise<void> {
    if (transcript.mergedS3Url) return;
    const mergedKey = transcriptMergedKey(meetingId);
    await this.s3.putJson(mergedKey, { meetingId, turns: transcript.turns ?? [] });
    await this.prisma.transcript.update({
      where: { meetingId },
      data: { mergedS3Url: mergedKey },
    });
    this.logger.log({ meetingId, mergedKey }, 'merge: merged.json зеркалирован в S3 (backfill)');
  }

  /**
   * ТЗ 2026-05-25, Фаза 4 — producer для `core.meeting-report-fast`.
   *
   * Запускается параллельно с `enqueueAnalyze` / `enqueueBehaviorMetrics`,
   * как только транскрипт готов (`turns` записаны или уже были). Управляется
   * ENV-флагом `MEETING_REPORT_FAST_ENABLED` через
   * `cfg.knowledgeCore.meetingReportFastEnabled`:
   *   - default true (dev): job уходит в очередь;
   *   - false (prod до явного включения): producer пропускается, в логи
   *     пишется info-сообщение.
   *
   * Идемпотентность обеспечивает `CoreQueueService.enqueueMeetingReportFast`
   * через `jobId = meeting_report_fast_<meetingId>` — повторный merge для той
   * же встречи не создаст дубль.
   *
   * Ошибки producer'а не валят merge: legacy `ai.analyze` цепочка остаётся
   * работать. Логируем warn и продолжаем.
   */
  private async maybeEnqueueMeetingReportFast(meetingId: string): Promise<void> {
    if (!this.cfg.knowledgeCore.meetingReportFastEnabled) {
      this.logger.log(
        { meetingId },
        'merge: MEETING_REPORT_FAST_ENABLED=false — producer meeting-report-fast пропущен',
      );
      return;
    }
    if (!this.coreQueue) {
      // В рантайме coreQueue резолвится через DI; в spec'ах он может быть
      // не передан — это ожидаемый optional, просто пропускаем.
      this.logger.debug(
        { meetingId },
        'merge: CoreQueueService не доступен — meeting-report-fast пропущен',
      );
      return;
    }
    try {
      await this.coreQueue.enqueueMeetingReportFast(meetingId);
      this.logger.log(
        { meetingId },
        'merge: meeting-report-fast — job поставлен в core.meeting-report-fast',
      );
    } catch (err) {
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'merge: не удалось поставить core.meeting-report-fast (продолжаем без fast-отчёта)',
      );
    }
  }

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) return;
    const meetingId = job.data.meetingId;
    try {
      await this.meetings.transitionStatus(meetingId, 'failed', {
        failureReason: `merge: ${err.message}`,
        reason: 'ai:merge:final_failure',
      });
      this.metrics.incMeetingFailed('merge');
    } catch (e) {
      this.logger.warn(
        `merge failed → fsm transition: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
