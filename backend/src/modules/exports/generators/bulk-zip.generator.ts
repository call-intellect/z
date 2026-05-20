import { PassThrough } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import type { Meeting } from '@prisma/client';
import { ZipArchive } from 'archiver';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';

import { MdGenerator } from './md.generator';

interface BuildResult {
  buffer: Buffer;
  bytes: number;
}

/**
 * Генератор bulk-zip для нескольких встреч.
 *
 * Содержимое:
 *   - `<title>.md` — MD-отчёт по каждой встрече
 *   - `<title>-transcript.json` — если includeTranscript
 *   - `_links.txt` — presigned URL'ы на видео/аудио (БЕЗ файлов; десятки гигабайт
 *     не пихаем в один zip)
 *
 * Лимит итогового размера — `cfg.workspace.exportZipMaxBytes`. Если превышен,
 * throw `ZipSizeLimitExceededError`.
 */
export class ZipSizeLimitExceededError extends Error {
  constructor(public readonly bytes: number, public readonly limit: number) {
    super(`Bulk zip превысил лимит: ${bytes} > ${limit}`);
    this.name = 'ZipSizeLimitExceededError';
  }
}

@Injectable()
export class BulkZipGenerator {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(MdGenerator) private readonly md: MdGenerator,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async build(input: {
    meetings: Meeting[];
    options: {
      includeTranscript?: boolean;
      includeAudio?: boolean;
      includeVideo?: boolean;
    };
  }): Promise<BuildResult> {
    const limit = this.cfg.workspace.exportZipMaxBytes;
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let limitExceeded = false;

    stream.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > limit) {
        limitExceeded = true;
        // Прерываем archiver — abort.
        archive.abort();
      } else {
        chunks.push(chunk);
      }
    });

    archive.pipe(stream);

    const linksLines: string[] = ['# Ссылки на медиа', ''];

    for (const meeting of input.meetings) {
      const safeName = sanitizeName(meeting.title || meeting.id);
      const [aiResult, chapters, tasks, transcript, recording] = await Promise.all([
        this.prisma.aiResult.findUnique({ where: { meetingId: meeting.id } }),
        this.prisma.meetingChapter.findMany({
          where: { meetingId: meeting.id },
          orderBy: { startMs: 'asc' },
        }),
        this.prisma.task.findMany({
          where: { meetingId: meeting.id },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.transcript.findUnique({ where: { meetingId: meeting.id } }),
        this.prisma.recording.findUnique({
          where: { meetingId: meeting.id },
          include: { audioTracks: true },
        }),
      ]);

      const md = this.md.build({ meeting, aiResult, chapters, tasks, transcript });
      archive.append(md, { name: `${safeName}/${safeName}.md` });

      if (input.options.includeTranscript && transcript?.mergedS3Url) {
        // Не качаем огромные транскрипты в zip — пишем ссылку.
        linksLines.push(`## ${meeting.title} — transcript`);
        linksLines.push(`s3://${transcript.mergedS3Url}`);
        linksLines.push('');
      }

      if (input.options.includeVideo && recording?.mainVideoUrl) {
        linksLines.push(`## ${meeting.title} — video`);
        linksLines.push(recording.mainVideoUrl);
        linksLines.push('');
      }

      if (input.options.includeAudio && recording?.audioTracks?.length) {
        linksLines.push(`## ${meeting.title} — audio tracks`);
        for (const t of recording.audioTracks) {
          linksLines.push(t.audioUrl);
        }
        linksLines.push('');
      }
    }

    archive.append(linksLines.join('\n'), { name: '_links.txt' });

    await archive.finalize();
    // Ждём, пока pipe закончит — небольшой defer.
    await new Promise<void>((resolve) => {
      stream.on('end', () => resolve());
      stream.on('close', () => resolve());
    });

    if (limitExceeded) {
      throw new ZipSizeLimitExceededError(totalBytes, limit);
    }

    return { buffer: Buffer.concat(chunks), bytes: totalBytes };
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/gu, '_').slice(0, 80);
}
