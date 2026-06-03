import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { type AiJobData, QUEUE_NAMES } from '../../ai/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { extractKeyFromUrl } from '../s3-keys';
import { S3Service } from '../s3.service';

/**
 * Worker очереди `recording.faststart` (ТЗ 2026-06-03 meeting-recording-reliability,
 * Фаза 3, P1).
 *
 * Зачем: LiveKit Egress кодирует composite MP4 через GStreamer `mp4mux` с
 * `faststart=false` по умолчанию → metadata-atom `moov` пишется в КОНЕЦ файла.
 * Браузеру `moov` нужен ДО старта воспроизведения, поэтому на большом файле
 * (383 МБ на 17-мин встрече; гигабайты на 1–2 ч) плеер тянет весь файл прежде
 * первого кадра — «вечная крутилка». `EncodedFileOutput` не выставляет
 * faststart-опцию (подтверждено Context7 LiveKit Egress), поэтому переупаковываем
 * пост-фактум: `ffmpeg -c copy -movflags +faststart` (без перекодирования —
 * секунды) и перезаливаем в S3 по тому же ключу (mainVideoUrl остаётся валиден).
 *
 * Гейтинг: `RECORDING_FASTSTART_ENABLED` (дефолт OFF — требует ffmpeg в образе
 * и эмпирической проверки на проде). Concurrency=1 — ffmpeg/IO тяжёлые.
 * Идемпотентность: фиксированный jobId по meetingId + сам ремукс идемпотентен
 * (faststart-файл, переупакованный повторно, остаётся faststart).
 *
 * Ffmpeg должен быть в PATH контейнера (Dockerfile backend: `apk add ffmpeg`).
 */
@Injectable()
export class FaststartWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FaststartWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.RECORDING_FASTSTART,
      async (job: Job<AiJobData>) =>
        this.pipe.job(SystemLogPipeline.RECORDING, 'recording.faststart', job, () =>
          this.processMeeting(job.data.meetingId),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.logger.log(`FaststartWorker запущен (${QUEUE_NAMES.RECORDING_FASTSTART})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Переупаковка composite MP4 в faststart. Идемпотентна и безопасна для
   * повторного запуска. Публичный метод — для прямого вызова в тестах.
   */
  async processMeeting(meetingId: string): Promise<void> {
    // Defense-in-depth: если флаг выключили уже после постановки job'а — skip.
    if (!this.cfg.recording.faststartEnabled) {
      this.logger.debug({ meetingId }, 'faststart: выключен флагом — skip');
      return;
    }

    const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (!recording?.mainVideoUrl) {
      this.logger.warn({ meetingId }, 'faststart: нет mainVideoUrl — skip');
      return;
    }

    // Порог по размеру: мелкий composite браузер проглатывает мгновенно даже с
    // moov в конце — ремукс был бы лишней нагрузкой. Если размер неизвестен
    // (bytesTotal=null) — обрабатываем (мог быть большим).
    const minBytes = this.cfg.recording.faststartMinBytes;
    const bytes = recording.bytesTotal !== null ? Number(recording.bytesTotal) : null;
    if (bytes !== null && bytes < minBytes) {
      this.logger.debug(
        { meetingId, bytes, minBytes },
        'faststart: composite меньше порога — skip',
      );
      return;
    }

    const key = extractKeyFromUrl(recording.mainVideoUrl, this.cfg.s3.bucket);
    if (!key) {
      this.logger.warn(
        { meetingId, mainVideoUrl: recording.mainVideoUrl },
        'faststart: не удалось извлечь S3-ключ — skip',
      );
      return;
    }

    let tempDir: string | null = null;
    try {
      tempDir = await mkdtemp(join(tmpdir(), 'z-faststart-'));
      const srcPath = join(tempDir, 'src.mp4');
      const outPath = join(tempDir, 'out.mp4');

      const srcBuffer = await this.s3.getObject(key);
      await writeFile(srcPath, srcBuffer);

      // -c copy: без перекодирования (ремукс, секунды).
      // -movflags +faststart: переносит moov-atom в начало файла.
      await this.runFfmpeg([
        '-y',
        '-i',
        srcPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outPath,
      ]);

      const outBuffer = await readFile(outPath);
      // Перезаливаем по тому же ключу — mainVideoUrl/AudioTrack/presign не меняются.
      await this.s3.putObject({ key, body: outBuffer, contentType: 'video/mp4' });

      this.logger.log(
        { meetingId, key, bytes: outBuffer.byteLength },
        'faststart: composite переупакован (moov в начало)',
      );
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** Запуск ffmpeg как child process. `protected` — переопределяется в тестах. */
  protected runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-2000)}`));
      });
    });
  }
}
