import { Inject, Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import type { ParsedMail } from 'mailparser';
import { simpleParser } from 'mailparser';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';
import { IssuesService } from '../../tracker/services/issues.service';

@Injectable()
export class ProjectInboxService {
  private readonly logger = new Logger(ProjectInboxService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async pollInbox(): Promise<{
    processed: number;
    created: number;
    bounced: number;
    failed: number;
    skipped: number;
  }> {
    const result = { processed: 0, created: 0, bounced: 0, failed: 0, skipped: 0 };

    const c = this.cfg.mailInbox;
    if (!c.enabled) {
      this.logger.debug('MAIL_INBOX_ENABLED=false — поллер пропущен');
      return result;
    }
    if (!c.imapHost || !c.imapUser || !c.imapPass) {
      this.logger.warn('mail-inbox: MAIL_INBOX_IMAP_HOST/USER/PASS не заданы — поллер пропущен');
      return result;
    }

    const client = new ImapFlow({
      host: c.imapHost,
      port: c.imapPort,
      secure: c.imapTls,
      auth: { user: c.imapUser, pass: c.imapPass },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock(c.imapFolder);
      try {
        const searchResult = await client.search({ seen: false });
        const uids: number[] = Array.isArray(searchResult)
          ? searchResult.slice(0, c.maxPerRun)
          : [];
        if (uids.length === 0) {
          return result;
        }

        for (const uid of uids) {
          result.processed++;
          try {
            const msg = await client.fetchOne(
              String(uid),
              { source: true, envelope: true, internalDate: true },
              { uid: true },
            );
            if (!msg || !msg.source) {
              result.skipped++;
              continue;
            }
            const parsed = await simpleParser(msg.source);
            const outcome = await this.processOne(parsed);

            if (outcome === 'created') result.created++;
            else if (outcome === 'bounced') result.bounced++;
            else if (outcome === 'duplicate') result.skipped++;
            else if (outcome === 'failed') {
              result.failed++;
              continue;
            }
            await client
              .messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
              .catch(() => undefined);
          } catch (err) {
            result.failed++;
            this.logger.warn(
              { uid, err: err instanceof Error ? err.message : String(err) },
              'mail-inbox: ошибка обработки письма (uid)',
            );
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

    this.logger.log(result, 'mail-inbox: проход завершён');
    return result;
  }

  async processOne(parsed: ParsedMail): Promise<'created' | 'bounced' | 'duplicate' | 'failed'> {
    const messageId = (parsed.messageId ?? '').replace(/^<|>$/g, '').trim();
    if (!messageId) {
      this.logger.warn({ subject: parsed.subject }, 'mail-inbox: письмо без Message-ID — skip');
      this.metrics.incMailInboundBounce({ reason: 'no_message_id' });
      return 'failed';
    }

    const seen = await this.prisma.mailInboundLog.findUnique({
      where: { messageId },
      select: { id: true, status: true },
    });
    if (seen) {
      return 'duplicate';
    }

    const fromEmail = this.extractFromEmail(parsed) ?? '';
    const subject = (parsed.subject ?? '').slice(0, 500) || '(без темы)';

    const alias = this.extractAlias(parsed);
    if (!alias) {
      await this.prisma.mailInboundLog.create({
        data: {
          tenantId: '',
          projectId: null,
          messageId,
          fromEmail,
          subject,
          status: 'bounced',
          reason: 'no_alias_in_to',
        },
      });
      this.metrics.incMailInboundReceived({ projectId: '', status: 'bounced' });
      this.metrics.incMailInboundBounce({ reason: 'no_alias_in_to' });
      return 'bounced';
    }

    const project = await this.prisma.project.findUnique({
      where: { emailInboxAlias: alias },
      select: {
        id: true,
        tenantId: true,
        ownerId: true,
        emailInboxEnabled: true,
        deletedAt: true,
      },
    });
    if (!project || project.deletedAt) {
      await this.prisma.mailInboundLog.create({
        data: {
          tenantId: '',
          projectId: null,
          messageId,
          fromEmail,
          subject,
          status: 'bounced',
          reason: 'alias_not_found',
        },
      });
      this.metrics.incMailInboundReceived({ projectId: '', status: 'bounced' });
      this.metrics.incMailInboundBounce({ reason: 'alias_not_found' });
      return 'bounced';
    }
    if (!project.emailInboxEnabled) {
      await this.prisma.mailInboundLog.create({
        data: {
          tenantId: project.tenantId,
          projectId: project.id,
          messageId,
          fromEmail,
          subject,
          status: 'bounced',
          reason: 'disabled',
        },
      });
      this.metrics.incMailInboundReceived({
        projectId: project.id,
        status: 'bounced',
      });
      this.metrics.incMailInboundBounce({ reason: 'disabled' });
      return 'bounced';
    }

    const description = this.extractDescription(parsed);

    let issueId: string;
    try {
      const issue = await this.issues.create(
        project.id,
        {
          title: subject.slice(0, 200),
          description,
          priority: 'none',
          sortOrder: 0,
          assigneeUserIds: [],
          labelIds: [],
          externalSource: 'email',
          externalId: messageId.slice(0, 200),
        },
        project.tenantId,
        project.ownerId,
      );
      issueId = issue.id;
    } catch (err) {
      this.logger.warn(
        {
          messageId,
          projectId: project.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'mail-inbox: IssuesService.create() упал',
      );
      try {
        await this.prisma.mailInboundLog.create({
          data: {
            tenantId: project.tenantId,
            projectId: project.id,
            messageId,
            fromEmail,
            subject,
            status: 'failed',
            reason: err instanceof Error ? err.message.slice(0, 500) : 'unknown_error',
          },
        });
      } catch {}
      this.metrics.incMailInboundReceived({
        projectId: project.id,
        status: 'failed',
      });
      return 'failed';
    }

    await this.uploadAttachments({
      parsed,
      tenantId: project.tenantId,
      projectId: project.id,
      issueId,
      messageId,
      uploaderId: project.ownerId,
    });

    await this.prisma.mailInboundLog.create({
      data: {
        tenantId: project.tenantId,
        projectId: project.id,
        messageId,
        fromEmail,
        subject,
        status: 'created',
        issueId,
      },
    });
    this.metrics.incMailInboundReceived({
      projectId: project.id,
      status: 'created',
    });
    this.metrics.incMailInboundIssueCreated();
    return 'created';
  }

  private extractAlias(parsed: ParsedMail): string | null {
    const domain = this.cfg.mailInbox.domain.toLowerCase();

    const fromAddr = (addr: string): string | null => {
      const m = /<?([^\s<>"]+)@([^\s<>"]+?)>?$/i.exec(addr.trim());
      if (!m) return null;
      const [, localPart, addrDomain] = m;
      if (!localPart || !addrDomain) return null;
      if (addrDomain.toLowerCase() !== domain) return null;
      return localPart.toLowerCase();
    };

    const headers = parsed.headers;
    const deliveredTo = headers.get('delivered-to');
    if (typeof deliveredTo === 'string') {
      const a = fromAddr(deliveredTo);
      if (a) return a;
    }
    const originalTo = headers.get('x-original-to');
    if (typeof originalTo === 'string') {
      const a = fromAddr(originalTo);
      if (a) return a;
    }

    const toField = parsed.to;
    const candidates: string[] = [];
    if (Array.isArray(toField)) {
      for (const t of toField) {
        if (t?.value) {
          for (const v of t.value) {
            if (v.address) candidates.push(v.address);
          }
        }
      }
    } else if (toField?.value) {
      for (const v of toField.value) {
        if (v.address) candidates.push(v.address);
      }
    }
    for (const addr of candidates) {
      const a = fromAddr(addr);
      if (a) return a;
    }
    return null;
  }

  private extractFromEmail(parsed: ParsedMail): string | null {
    const from = parsed.from;
    if (!from?.value || from.value.length === 0) return null;
    const first = from.value[0];
    if (!first?.address) return null;
    return first.address.slice(0, 320);
  }

  private extractDescription(parsed: ParsedMail): string {
    if (parsed.text) {
      return parsed.text.slice(0, 5000);
    }
    if (typeof parsed.html === 'string' && parsed.html.length > 0) {
      const stripped = parsed.html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return stripped.slice(0, 5000);
    }
    return '';
  }

  private async uploadAttachments(args: {
    parsed: ParsedMail;
    tenantId: string;
    projectId: string;
    issueId: string;
    messageId: string;
    uploaderId: string;
  }): Promise<void> {
    const atts = args.parsed.attachments ?? [];
    if (atts.length === 0) return;

    for (let i = 0; i < atts.length; i++) {
      const att = atts[i];
      if (!att?.content) continue;
      const filename = (att.filename ?? `attachment-${i}`).slice(0, 200);
      const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
      const size = att.size ?? att.content.byteLength;
      const contentType = att.contentType ?? 'application/octet-stream';
      const safeMessageId = args.messageId.replace(/[^A-Za-z0-9._-]/g, '_');
      const key = `mail-inbound/${args.tenantId}/${args.projectId}/${safeMessageId}/${safeName}`;
      try {
        await this.s3.putObject({
          key,
          body: att.content as Buffer,
          contentType,
        });
        await this.prisma.issueAttachment.create({
          data: {
            issueId: args.issueId,
            uploaderId: args.uploaderId,
            fileName: filename,
            fileUrl: key,
            fileSize: size,
            mimeType: contentType,
          },
        });
        this.metrics.incMailInboundAttachmentUploaded();
      } catch (err) {
        this.logger.warn(
          {
            issueId: args.issueId,
            key,
            err: err instanceof Error ? err.message : String(err),
          },
          'mail-inbox: не удалось сохранить вложение (best-effort, продолжаем)',
        );
      }
    }
  }
}
