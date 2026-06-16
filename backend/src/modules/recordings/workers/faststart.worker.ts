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

  async processMeeting(meetingId: string): Promise<void> {
    if (!this.cfg.recording.faststartEnabled) {
      this.logger.debug({ meetingId }, 'faststart: выключен флагом — skip');
      return;
    }

    const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (!recording?.mainVideoUrl) {
      this.logger.warn({ meetingId }, 'faststart: нет mainVideoUrl — skip');
      return;
    }

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

      await this.runFfmpeg(['-y', '-i', srcPath, '-c', 'copy', '-movflags', '+faststart', outPath]);

      const outBuffer = await readFile(outPath);
      await this.s3.putObject({ key, body: outBuffer, contentType: 'video/mp4' });

      this.logger.debug(
        { meetingId, key, bytes: outBuffer.byteLength },
        'faststart: composite переупакован (moov в начало)',
      );
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

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
