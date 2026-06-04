import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { S3Service } from '../../recordings/s3.service';
import { type ClipRenderJobData, QUEUE_NAMES } from '../queues';

/**
 * Worker очереди `clip.render` — нарезает MP4 из оригинала встречи
 * по `MeetingHighlight.startMs/endMs` через ffmpeg.
 *
 * Concurrency=1 — ffmpeg тяжёлый. Retry 2 (см. `CLIP_RENDER_JOB_OPTIONS`
 * в `ai-queue.service.ts`).
 *
 * Алгоритм:
 *   1. Достаём `MeetingHighlight` + `Meeting.recording.mainVideoUrl`.
 *   2. Валидируем длительность (`endMs-startMs <= clipMaxDurationSeconds*1000`).
 *   3. Скачиваем оригинал в tempfile (через S3.getObject — mainVideoUrl это S3-key).
 *   4. ffmpeg `-ss <start> -to <end> -c copy` (без перекодирования — быстро).
 *   5. Загружаем результат в S3 по ключу `clips/<meetingId>/<highlightId>.mp4`.
 *   6. Обновляем `MeetingHighlight.{renderStatus, renderedMp4Key}`.
 *   7. Удаляем temp-файлы.
 *
 * Ffmpeg должен быть в PATH worker-контейнера (Dockerfile дополним
 * на этапе деплоя).
 */
@Injectable()
export class ClipRenderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClipRenderWorker.name);
  private worker: Worker<ClipRenderJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ClipRenderJobData>(
      QUEUE_NAMES.CLIP_RENDER,
      async (job) =>
        this.pipe.job(SystemLogPipeline.AI_ANALYSIS, 'ai.clip-render', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(
          `onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    });
    this.logger.log(`ClipRenderWorker запущен (${QUEUE_NAMES.CLIP_RENDER})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<ClipRenderJobData>): Promise<void> {
    const { highlightId } = job.data;
    const startedAt = Date.now();
    let status: 'success' | 'clip_too_long' | 'failed' = 'failed';
    let tempDir: string | null = null;

    try {
      const highlight = await this.prisma.meetingHighlight.findUnique({
        where: { id: highlightId },
        include: { meeting: { include: { recording: true } } },
      });
      if (!highlight) {
        throw new Error(`clip-render: highlight ${highlightId} не найден`);
      }
      const mainVideoKey = highlight.meeting.recording?.mainVideoUrl;
      if (!mainVideoKey) {
        throw new Error(`clip-render: нет mainVideoUrl для meeting=${highlight.meetingId}`);
      }

      const durationMs = Math.max(0, highlight.endMs - highlight.startMs);
      const limitMs = this.cfg.workspace.clipMaxDurationSeconds * 1000;
      if (durationMs > limitMs) {
        status = 'clip_too_long';
        await this.prisma.meetingHighlight.update({
          where: { id: highlightId },
          data: {
            renderStatus: 'failed',
            renderError: `clip_too_long: длительность ${durationMs} ms > лимит ${limitMs} ms`,
          },
        });
        throw new Error(`clip_too_long: ${durationMs} ms`);
      }

      await this.prisma.meetingHighlight.update({
        where: { id: highlightId },
        data: { renderStatus: 'processing', renderError: null },
      });

      // 1. Скачиваем оригинал.
      tempDir = await mkdtemp(join(tmpdir(), 'z-clip-'));
      const srcPath = join(tempDir, 'src.mp4');
      const outPath = join(tempDir, 'out.mp4');
      const srcBuffer = await this.s3.getObject(mainVideoKey);
      await writeFile(srcPath, srcBuffer);

      // 2. ffmpeg -ss start -to end -c copy.
      const startSec = (highlight.startMs / 1000).toFixed(3);
      const endSec = (highlight.endMs / 1000).toFixed(3);
      await runFfmpeg([
        '-y',
        '-i',
        srcPath,
        '-ss',
        startSec,
        '-to',
        endSec,
        '-c',
        'copy',
        outPath,
      ]);

      // 3. Загружаем результат.
      const outBuffer = await readFile(outPath);
      const targetKey = `clips/${highlight.meetingId}/${highlightId}.mp4`;
      await this.s3.putObject({
        key: targetKey,
        body: outBuffer,
        contentType: 'video/mp4',
      });

      // 4. Обновляем highlight.
      await this.prisma.meetingHighlight.update({
        where: { id: highlightId },
        data: {
          renderedMp4Key: targetKey,
          renderStatus: 'ready',
          renderError: null,
        },
      });
      status = 'success';
      this.logger.log(
        {
          highlightId,
          meetingId: highlight.meetingId,
          durationMs,
          renderedKey: targetKey,
        },
        'clip-render: успешно',
      );
    } catch (err) {
      this.logger.warn(
        {
          highlightId,
          err: err instanceof Error ? err.message : String(err),
        },
        'clip-render: ошибка',
      );
      // renderStatus='failed' выставляется в onJobFailed (после исчерпания retry).
      throw err;
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
      this.metrics?.observeMp4RenderDuration({
        status,
        seconds: (Date.now() - startedAt) / 1000,
      });
    }
  }

  private async onJobFailed(
    job: Job<ClipRenderJobData> | null,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 2)) return;
    const { highlightId } = job.data;
    try {
      await this.prisma.meetingHighlight.update({
        where: { id: highlightId },
        data: {
          renderStatus: 'failed',
          renderError: err.message.slice(0, 1000),
        },
      });
    } catch (e) {
      this.logger.warn(
        `clip-render onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/**
 * Запускает ffmpeg как child process. Резолвится при exit code 0,
 * иначе — Error со stderr.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // Ограничиваем размер буфера, чтобы не съесть память на длинных видео.
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
