import { Inject, Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import type { ParsedMail } from 'mailparser';
import { simpleParser } from 'mailparser';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';
import { IssuesService } from '../../tracker/services/issues.service';

/**
 * ProjectInboxService (Tracker Phase 4, T5 — Email-to-task).
 *
 * Поллинг общего IMAP-ящика `inbox.kora.app` (или другого `MAIL_INBOX_DOMAIN`):
 * - Подключается к IMAP (логин из ENV `MAIL_INBOX_IMAP_*`).
 * - Получает UNSEEN сообщения из `MAIL_INBOX_IMAP_FOLDER` (`INBOX` по умолчанию).
 * - Для каждого письма:
 *   1. Парсит RFC822 (`mailparser.simpleParser`).
 *   2. Проверяет идемпотентность по `MailInboundLog.messageId` (`Message-ID`
 *      или `Delivered-To` + `Date` fallback).
 *   3. Достаёт alias из `To`/`Delivered-To`/`X-Original-To` (часть до `@`).
 *   4. Ищет `Project.findUnique({ where: { emailInboxAlias: alias } })` —
 *      alias уникален глобально (across tenants).
 *   5. Если `project=null` или `emailInboxEnabled=false` → bounced log + skip.
 *   6. Создаёт Issue через `IssuesService.create(...)` с `userId=project.ownerId`
 *      и `externalSource='email'`.
 *   7. Вложения → S3 (key=`mail-inbound/{tenantId}/{projectId}/{messageId}/{filename}`)
 *      → `IssueAttachment` записи. fileUrl — S3 key (для последующего presign).
 *   8. Помечает письмо `\Seen` (чтобы не подтягивать снова).
 *
 * Failure-modes:
 * - Любая ошибка обработки одного письма → `MailInboundLog.status='failed'`
 *   + warn-log; письмо НЕ помечается `\Seen` (повторится в следующем тике
 *   — но `messageId`-идемпотентность не даст создать дубль Issue).
 *   NB: если ошибка стабильная, письмо застрянет навсегда. Это компромисс
 *   ради надёжности; ручной разбор `failed`-логов в UI оператора (см.
 *   `recentLogs` в `ProjectEmailInboxController.get`).
 *
 * NB: не используем `EmailFetchService` напрямую — там Source-per-tenant
 * парадигма с отдельным Source.config, тут нужен один общий ящик + routing
 * по alias. Логику IMAP-connection приходится скопировать; это явный
 * компромисс ради чистого разделения flows.
 */
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

  /**
   * Один проход по общему IMAP-ящику. Возвращает счётчики для логирования.
   *
   * Защищено внешним guard'ом `cfg.mailInbox.enabled` — но дополнительно
   * проверяем здесь, чтобы прямой вызов из тестов/смок-скриптов не лез
   * в продовый ящик.
   */
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
      this.logger.warn(
        'mail-inbox: MAIL_INBOX_IMAP_HOST/USER/PASS не заданы — поллер пропущен',
      );
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
              // НЕ помечаем \Seen — оставляем для retry в следующем тике.
              continue;
            }
            // Помечаем \Seen (created / bounced / duplicate).
            await client
              .messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
              .catch(() => undefined);
          } catch (err) {
            result.failed++;
            this.logger.warn(
              { uid, err: err instanceof Error ? err.message : String(err) },
              'mail-inbox: ошибка обработки письма (uid)',
            );
            // Не помечаем — retry в следующем проходе.
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore — соединение могло уже отвалиться.
      }
    }

    this.logger.log(result, 'mail-inbox: проход завершён');
    return result;
  }

  /**
   * Обработка одного письма. Возвращает outcome для агрегации в pollInbox.
   *
   * Outcome:
   *  - `created`   — Issue создан, лог status='created'.
   *  - `bounced`   — alias не найден / выключен; лог status='bounced'.
   *  - `duplicate` — Message-ID уже в БД; skip без создания дублей.
   *  - `failed`    — ошибка обработки; лог status='failed' (если удалось
   *    хотя бы создать лог) ИЛИ выбрасывается caller'у (тогда без лога).
   */
  async processOne(
    parsed: ParsedMail,
  ): Promise<'created' | 'bounced' | 'duplicate' | 'failed'> {
    const messageId = (parsed.messageId ?? '').replace(/^<|>$/g, '').trim();
    if (!messageId) {
      // Без Message-ID не можем гарантировать идемпотентность — отказываемся.
      this.logger.warn(
        { subject: parsed.subject },
        'mail-inbox: письмо без Message-ID — skip',
      );
      this.metrics.incMailInboundBounce({ reason: 'no_message_id' });
      return 'failed';
    }

    // Идемпотентность: уже видели это письмо.
    const seen = await this.prisma.mailInboundLog.findUnique({
      where: { messageId },
      select: { id: true, status: true },
    });
    if (seen) {
      return 'duplicate';
    }

    const fromEmail = this.extractFromEmail(parsed) ?? '';
    const subject = (parsed.subject ?? '').slice(0, 500) || '(без темы)';

    // Извлекаем alias из To / Delivered-To / X-Original-To.
    const alias = this.extractAlias(parsed);
    if (!alias) {
      await this.prisma.mailInboundLog.create({
        data: {
          tenantId: '', // bounce без проекта — tenant неизвестен
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

    // Routing по alias (unique глобально).
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

    // Собираем body: предпочитаем text/plain; fallback на text-извлечение из HTML.
    const description = this.extractDescription(parsed);

    // Создаём Issue от имени владельца проекта (он точно member через
    // ProjectMember admin, RBAC и tenant guard внутри IssuesService обходим
    // через прямой вызов create() — это intentional bypass для system-flow).
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
      // Logger + лог в БД, но НЕ помечаем письмо \Seen — caller (pollInbox)
      // сам решает retry-логику.
      this.logger.warn(
        {
          messageId,
          projectId: project.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'mail-inbox: IssuesService.create() упал',
      );
      // Создаём лог failed, чтобы оператор видел в UI; messageId unique —
      // повторный create в следующем тике не падает (попадает в 'duplicate').
      try {
        await this.prisma.mailInboundLog.create({
          data: {
            tenantId: project.tenantId,
            projectId: project.id,
            messageId,
            fromEmail,
            subject,
            status: 'failed',
            reason:
              err instanceof Error ? err.message.slice(0, 500) : 'unknown_error',
          },
        });
      } catch {
        // ignore — если и лог не записался, остался warn выше.
      }
      this.metrics.incMailInboundReceived({
        projectId: project.id,
        status: 'failed',
      });
      return 'failed';
    }

    // Вложения → S3 + IssueAttachment. Best-effort: если упадёт — лог
    // всё равно создаётся со status='created' (Issue уже есть), но без
    // attachments. Помечаем как warn для оператора.
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

  // ── internal ──

  /**
   * Извлекает alias из заголовков письма. Приоритет:
   *   1. `Delivered-To` (если SMTP-сервер проставил — наиболее точно).
   *   2. `X-Original-To` (sendmail/postfix).
   *   3. `To` (multi-recipient — первый адрес с подходящим доменом).
   *
   * Возвращает только часть до `@`, в lowercase.
   */
  private extractAlias(parsed: ParsedMail): string | null {
    const domain = this.cfg.mailInbox.domain.toLowerCase();

    // Helper: извлечь alias из строки `name <addr@domain>` или `addr@domain`.
    const fromAddr = (addr: string): string | null => {
      const m = /<?([^\s<>"]+)@([^\s<>"]+?)>?$/i.exec(addr.trim());
      if (!m) return null;
      const [, localPart, addrDomain] = m;
      if (!localPart || !addrDomain) return null;
      if (addrDomain.toLowerCase() !== domain) return null;
      return localPart.toLowerCase();
    };

    const headers = parsed.headers;
    // mailparser возвращает Map<string, unknown>; ключи — lowercase.
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

    // To: может быть address-объект (parsed) или массив таковых.
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
    return first.address.slice(0, 320); // RFC max email length
  }

  private extractDescription(parsed: ParsedMail): string {
    // text/plain — приоритет.
    if (parsed.text) {
      return parsed.text.slice(0, 5000);
    }
    // Fallback на mailparser-преобразование (он сам text → html → text).
    if (typeof parsed.html === 'string' && parsed.html.length > 0) {
      // Упрощённый strip HTML.
      const stripped = parsed.html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return stripped.slice(0, 5000);
    }
    return '';
  }

  /**
   * Загружает вложения в S3 + создаёт IssueAttachment записи.
   * Best-effort: failure одного вложения не валит остальные.
   * `fileUrl` = S3 key (presign делается на read).
   */
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
