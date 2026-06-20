import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DataClass, Source } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { S3Service } from '../../../recordings/s3.service';
import type { SourceTestResultDto } from '../../../sources/dto/source.dto';
import { IngestService } from '../../ingest.service';

import { parseImapConfig, type ImapMailboxConfig } from './imap-config.schema';

@Injectable()
export class EmailFetchService {
  private readonly logger = new Logger(EmailFetchService.name);

  private static readonly ATTACHMENT_INLINE_LIMIT = 1 * 1024 * 1024;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async fetchOne(sourceId: string): Promise<{ ingested: number; skipped: number }> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException({ ok: false, error: { code: 'source_not_found' } });
    if (source.type !== 'email') {
      throw new BadRequestException({ ok: false, error: { code: 'wrong_source_type' } });
    }
    if (!source.isActive) {
      return { ingested: 0, skipped: 0 };
    }
    const config = parseImapConfig(source.config);
    const password = this.decryptIfNeeded(config.passwordEnc);
    const limit = this.cfg.emailFetch.maxPerRun;

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: password },
      logger: false,
    });

    let ingested = 0;
    let skipped = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.folder);
      try {
        const since = await this.computeSince(source.id, config);
        const searchResult = await client.search({ seen: false, since });
        const uids: number[] = Array.isArray(searchResult) ? searchResult.slice(0, limit) : [];
        if (uids.length === 0) {
          return { ingested: 0, skipped: 0 };
        }

        for (const uid of uids) {
          try {
            const msg = await client.fetchOne(
              String(uid),
              { source: true, envelope: true, internalDate: true },
              { uid: true },
            );
            if (!msg || !msg.source) {
              skipped++;
              continue;
            }
            const parsed = await simpleParser(msg.source);
            const fallbackDate: Date = parsed.date ?? toDate(msg.internalDate) ?? new Date();
            const externalId =
              parsed.messageId?.trim() ||
              this.fallbackExternalId({
                from: addressToString(parsed.from),
                subject: parsed.subject ?? '',
                date: fallbackDate,
                bodyLen: parsed.text?.length ?? 0,
              });

            const attachmentsMeta: Array<{
              filename: string;
              contentType: string;
              size: number;
              s3Key?: string;
            }> = [];
            for (const att of parsed.attachments ?? []) {
              const size = att.size ?? att.content?.byteLength ?? 0;
              const meta: { filename: string; contentType: string; size: number; s3Key?: string } =
                {
                  filename: att.filename ?? 'unnamed',
                  contentType: att.contentType ?? 'application/octet-stream',
                  size,
                };
              if (size >= EmailFetchService.ATTACHMENT_INLINE_LIMIT && att.content) {
                const safeName = (att.filename ?? `attachment-${attachmentsMeta.length}`).replace(
                  /[^A-Za-z0-9._-]/g,
                  '_',
                );
                const key = `email-attachments/${source.tenantId}/${externalId}/${safeName}`;
                await this.s3
                  .putObject({ key, body: att.content as Buffer, contentType: meta.contentType })
                  .catch((err) => {
                    this.logger.warn(
                      {
                        sourceId: source.id,
                        externalId,
                        key,
                        err: err instanceof Error ? err.message : String(err),
                      },
                      'email: не удалось загрузить вложение в S3',
                    );
                  });
                meta.s3Key = key;
              }
              attachmentsMeta.push(meta);
            }

            const dataClass: DataClass = config.sensitiveFolders.includes(config.folder)
              ? 'sensitive'
              : source.dataClass;

            const occurredAt: Date = fallbackDate;
            const payload = {
              messageId: externalId,
              from: addressToObject(parsed.from),
              to: addressListToObject(parsed.to),
              cc: addressListToObject(parsed.cc),
              subject: parsed.subject ?? null,
              date: occurredAt.toISOString(),
              folder: config.folder,
              text: parsed.text ?? null,
              fullText: [parsed.subject, parsed.text].filter(Boolean).join('\n\n'),
              html: typeof parsed.html === 'string' ? parsed.html : null,
              attachments: attachmentsMeta,
            };

            await this.ingest.ingest({
              tenantId: source.tenantId,
              sourceId: source.id,
              sourceExternalId: externalId,
              occurredAt,
              payload,
              dataClass,
            });
            await client
              .messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
              .catch(() => undefined);
            ingested++;
          } catch (err) {
            this.logger.warn(
              { sourceId: source.id, uid, err: err instanceof Error ? err.message : String(err) },
              'email: ошибка обработки письма',
            );
            skipped++;
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {}
    }
    this.logger.log({ sourceId: source.id, ingested, skipped }, 'email: проход завершён');
    return { ingested, skipped };
  }

  async test(source: Source): Promise<SourceTestResultDto> {
    if (source.type !== 'email') {
      return { ok: false, errorMessage: 'Source не email' };
    }
    let config: ImapMailboxConfig;
    try {
      config = parseImapConfig(source.config);
    } catch (err) {
      return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
    }
    const password = this.decryptIfNeeded(config.passwordEnc);
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: password },
      logger: false,
    });
    try {
      await client.connect();
      const folders = await client.list();
      const lock = await client.getMailboxLock(config.folder);
      let lastUid: number | null = null;
      try {
        const status = await client.status(config.folder, { uidNext: true, messages: true });
        lastUid = status.uidNext ?? null;
      } finally {
        lock.release();
      }
      return {
        ok: true,
        details: {
          folderCount: folders.length,
          folder: config.folder,
          lastUid,
        },
      };
    } catch (err) {
      return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
    } finally {
      try {
        await client.logout();
      } catch {}
    }
  }

  private decryptIfNeeded(value: string): string {
    if (this.crypto.isEncrypted(value)) {
      return this.crypto.decrypt(value);
    }
    return value;
  }

  private async computeSince(sourceId: string, config: ImapMailboxConfig): Promise<Date> {
    const last = await this.prisma.rawEvent.findFirst({
      where: { sourceId },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });
    if (last?.receivedAt) {
      return new Date(last.receivedAt.getTime() - 60_000);
    }
    if (config.sinceDate) {
      return new Date(config.sinceDate);
    }
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return sevenDaysAgo;
  }

  private fallbackExternalId(input: {
    from: string;
    subject: string;
    date: Date;
    bodyLen: number;
  }): string {
    const h = createHash('sha256');
    h.update(`${input.from}|${input.date.toISOString()}|${input.subject}|${input.bodyLen}`);
    return `email-fallback:${h.digest('hex').slice(0, 32)}`;
  }
}

function toDate(v: Date | string | undefined | null): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function addressToString(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const obj = a as { text?: string; value?: Array<{ address?: string }> };
  if (obj.text) return obj.text;
  if (Array.isArray(obj.value) && obj.value.length > 0) {
    return obj.value
      .map((v) => v.address ?? '')
      .filter(Boolean)
      .join(',');
  }
  return '';
}

function addressToObject(a: unknown): { name: string; address: string } | null {
  if (!a || typeof a !== 'object') return null;
  const obj = a as { value?: Array<{ name?: string; address?: string }> };
  if (Array.isArray(obj.value) && obj.value[0]) {
    return { name: obj.value[0].name ?? '', address: obj.value[0].address ?? '' };
  }
  return null;
}

function addressListToObject(a: unknown): Array<{ name: string; address: string }> {
  if (!a) return [];
  const items: Array<{ name?: string; address?: string }> = [];
  if (Array.isArray(a)) {
    for (const x of a) {
      const obj = x as { value?: Array<{ name?: string; address?: string }> };
      if (Array.isArray(obj.value)) items.push(...obj.value);
    }
  } else if (typeof a === 'object') {
    const obj = a as { value?: Array<{ name?: string; address?: string }> };
    if (Array.isArray(obj.value)) items.push(...obj.value);
  }
  return items.map((x) => ({ name: x.name ?? '', address: x.address ?? '' }));
}
