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
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { MeetingsService } from '../../meetings/meetings.service';
import { compositeKey } from '../../recordings/s3-keys';
import { S3Service } from '../../recordings/s3.service';
import { uploadAudioKey, uploadAudioWavKey } from '../meeting-upload-keys';
import { MeetingUploadsQueueService } from '../meeting-uploads-queue.service';
import { MEETING_UPLOAD_QUEUE_NAMES, type MeetingUploadJobData } from '../meeting-uploads.queues';

class IngestError extends Error {
  constructor(
    public readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'IngestError';
  }
}

interface FfprobeResult {
  hasAudio: boolean;
  nativeMp4: boolean;
}

@Injectable()
export class MeetingUploadIngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingUploadIngestWorker.name);
  private worker: Worker<MeetingUploadJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(MeetingUploadsQueueService)
    private readonly queue: MeetingUploadsQueueService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MeetingUploadJobData>(
      MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_INGEST,
      async (job: Job<MeetingUploadJobData>) =>
        this.pipe.job(SystemLogPipeline.RECORDING, 'meeting.upload-ingest', job, () =>
          this.processMeeting(job.data.meetingId),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.logger.debug(
      `MeetingUploadIngestWorker запущен (${MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_INGEST})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async processMeeting(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, source: true, status: true, tenantId: true },
    });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'upload-ingest: встреча не найдена — skip');
      return;
    }
    if (meeting.source !== 'upload') {
      this.logger.warn({ meetingId }, 'upload-ingest: не upload-встреча — skip');
      return;
    }
    if (meeting.status !== 'scheduled') {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'upload-ingest: встреча не в scheduled — повторный ingest no-op',
      );
      return;
    }

    const sourceKeys = await this.s3.listKeys(`meetings/${meetingId}/upload/source.`);
    const sourceKey = sourceKeys[0];
    if (!sourceKey) {
      await this.fail(meetingId, 'UPLOAD_DECODE_FAILED', 'исходный файл не найден в S3');
      throw new IngestError('UPLOAD_DECODE_FAILED', 'source object missing');
    }

    await this.meetings.transitionStatus(meetingId, 'recording_processing', {
      reason: 'upload_ingest_start',
    });

    let tempDir: string | null = null;
    try {
      tempDir = await mkdtemp(join(tmpdir(), 'z-upload-ingest-'));
      const srcExt = sourceKey.slice(sourceKey.lastIndexOf('.') + 1) || 'bin';
      const srcPath = join(tempDir, `src.${srcExt}`);
      const srcBuffer = await this.s3.getObject(sourceKey);
      await writeFile(srcPath, srcBuffer);

      const probe = await this.probe(meetingId, srcPath);
      if (!probe.hasAudio) {
        await this.fail(meetingId, 'UPLOAD_NO_AUDIO_STREAM', 'нет аудио-дорожки');
        throw new IngestError('UPLOAD_NO_AUDIO_STREAM');
      }

      const audioKey = await this.extractAudio(meetingId, srcPath, tempDir);
      this.logger.debug({ meetingId, audioKey }, 'upload-ingest: аудио нормализовано и залито');

      let mainVideoUrl: string | null = null;
      if (probe.nativeMp4) {
        mainVideoUrl = await this.remuxFaststart(meetingId, srcPath, tempDir);
        this.logger.debug({ meetingId, mainVideoUrl }, 'upload-ingest: видео faststart готово');
      }

      const retentionDays = this.cfg.retention.defaultDays;
      const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
      await this.prisma.recording.upsert({
        where: { meetingId },
        update: {
          status: 'ready',
          retentionDays,
          expiresAt,
          ...(mainVideoUrl !== null ? { mainVideoUrl } : {}),
          deletedAt: null,
          archivedAt: null,
        },
        create: {
          meetingId,
          status: 'ready',
          retentionDays,
          expiresAt,
          ...(mainVideoUrl !== null ? { mainVideoUrl } : {}),
        },
      });

      await this.meetings.transitionStatus(meetingId, 'recording_ready', {
        reason: 'upload_ingest_done',
      });

      await this.queue.enqueueUploadTranscribe(meetingId);

      this.logger.debug(
        { meetingId, nativeVideo: probe.nativeMp4 },
        'upload-ingest: медиа готово, transcribe поставлен',
      );
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private async extractAudio(meetingId: string, srcPath: string, tempDir: string): Promise<string> {
    const oggPath = join(tempDir, 'audio.ogg');
    try {
      await this.runFfmpeg([
        '-hide_banner',
        '-y',
        '-i',
        srcPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'libopus',
        '-b:a',
        '24k',
        oggPath,
      ]);
      const buf = await readFile(oggPath);
      const key = uploadAudioKey(meetingId);
      await this.s3.putObject({ key, body: buf, contentType: 'audio/ogg' });
      return key;
    } catch (err) {
      this.logger.warn(
        { meetingId, err: err instanceof Error ? err.message : String(err) },
        'upload-ingest: opus-энкод не удался — fallback на PCM wav',
      );
      const wavPath = join(tempDir, 'audio.wav');
      try {
        await this.runFfmpeg([
          '-hide_banner',
          '-y',
          '-i',
          srcPath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          wavPath,
        ]);
      } catch (err2) {
        await this.fail(
          meetingId,
          'UPLOAD_DECODE_FAILED',
          err2 instanceof Error ? err2.message : String(err2),
        );
        throw new IngestError('UPLOAD_DECODE_FAILED');
      }
      const buf = await readFile(wavPath);
      const key = uploadAudioWavKey(meetingId);
      await this.s3.putObject({ key, body: buf, contentType: 'audio/wav' });
      return key;
    }
  }

  private async remuxFaststart(
    meetingId: string,
    srcPath: string,
    tempDir: string,
  ): Promise<string> {
    const outPath = join(tempDir, 'out.mp4');
    await this.runFfmpeg(['-y', '-i', srcPath, '-c', 'copy', '-movflags', '+faststart', outPath]);
    const buf = await readFile(outPath);
    const key = compositeKey(meetingId);
    await this.s3.putObject({ key, body: buf, contentType: 'video/mp4' });
    return `s3://${this.cfg.s3.bucket}/${key}`;
  }

  private async probe(meetingId: string, srcPath: string): Promise<FfprobeResult> {
    let raw: string;
    try {
      raw = await this.runFfprobe([
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        srcPath,
      ]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.fail(meetingId, 'UPLOAD_DECODE_FAILED', detail);
      throw new IngestError('UPLOAD_DECODE_FAILED', detail);
    }

    let parsed: {
      streams?: Array<{ codec_type?: string; codec_name?: string }>;
      format?: { format_name?: string };
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      await this.fail(meetingId, 'UPLOAD_DECODE_FAILED', 'ffprobe вернул невалидный JSON');
      throw new IngestError('UPLOAD_DECODE_FAILED', 'ffprobe вернул невалидный JSON');
    }

    const streams = parsed.streams ?? [];
    const hasAudio = streams.some((s) => s.codec_type === 'audio');
    const formatName = parsed.format?.format_name ?? '';
    const isMp4Container = /mp4|mov|m4a|3gp/i.test(formatName);
    const hasH264 = streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264');
    const hasAac = streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac');
    const nativeMp4 = isMp4Container && hasH264 && hasAac;

    return { hasAudio, nativeMp4 };
  }

  private async fail(meetingId: string, code: string, detail?: string): Promise<void> {
    const reason = detail ? `${code}: ${detail}` : code;
    try {
      await this.meetings.transitionStatus(meetingId, 'failed', {
        failureReason: reason,
        reason: code,
      });
    } catch (err) {
      this.logger.warn(
        { meetingId, code, err: err instanceof Error ? err.message : String(err) },
        'upload-ingest: не удалось перевести встречу в failed',
      );
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

  protected runFfprobe(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`ffprobe exit ${code}: ${stderr.slice(-2000)}`));
      });
    });
  }
}
