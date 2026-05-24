import type { ParsedMail } from 'mailparser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { S3Service } from '../../recordings/s3.service';
import type { IssuesService } from '../../tracker/services/issues.service';

import { ProjectInboxService } from './project-inbox.service';

/**
 * Unit-тесты ProjectInboxService (Tracker Phase 4, T5).
 *
 * Покрытые сценарии:
 *  1. Парсинг To-alias → Project lookup → IssuesService.create() ОК.
 *  2. Attachment → S3Service.putObject + IssueAttachment.create.
 *  3. Bounce (alias не найден) → MailInboundLog status='bounced'.
 *  4. Идемпотентность: повторная обработка того же Message-ID → skip.
 *  5. Bounce при `emailInboxEnabled=false`.
 */
describe('ProjectInboxService', () => {
  let prisma: PrismaService;
  let cfg: TypedConfigService;
  let issues: IssuesService;
  let s3: S3Service;
  let metrics: BusinessMetricsService;
  let service: ProjectInboxService;

  let mailInboundFindUnique: ReturnType<typeof vi.fn>;
  let mailInboundCreate: ReturnType<typeof vi.fn>;
  let projectFindUnique: ReturnType<typeof vi.fn>;
  let issueAttachmentCreate: ReturnType<typeof vi.fn>;
  let issuesCreate: ReturnType<typeof vi.fn>;
  let s3PutObject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mailInboundFindUnique = vi.fn();
    mailInboundCreate = vi.fn().mockResolvedValue({ id: 'log_1' });
    projectFindUnique = vi.fn();
    issueAttachmentCreate = vi.fn().mockResolvedValue({ id: 'att_1' });
    issuesCreate = vi.fn();
    s3PutObject = vi.fn().mockResolvedValue(undefined);

    prisma = {
      mailInboundLog: {
        findUnique: mailInboundFindUnique,
        create: mailInboundCreate,
      },
      project: { findUnique: projectFindUnique },
      issueAttachment: { create: issueAttachmentCreate },
    } as unknown as PrismaService;

    cfg = {
      mailInbox: {
        enabled: true,
        domain: 'inbox.kora.app',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'inbox@kora.app',
        imapPass: 'secret',
        imapTls: true,
        imapFolder: 'INBOX',
        pollCron: '*/2 * * * *',
        maxPerRun: 50,
      },
    } as unknown as TypedConfigService;

    issues = { create: issuesCreate } as unknown as IssuesService;
    s3 = { putObject: s3PutObject } as unknown as S3Service;
    metrics = {
      incMailInboundReceived: vi.fn(),
      incMailInboundIssueCreated: vi.fn(),
      incMailInboundBounce: vi.fn(),
      incMailInboundAttachmentUploaded: vi.fn(),
    } as unknown as BusinessMetricsService;

    service = new ProjectInboxService(prisma, cfg, issues, s3, metrics);
  });

  /**
   * Helper: собирает минимальный ParsedMail c заданными полями.
   * mailparser-овский ParsedMail — большой тип, мы шепим только нужное.
   */
  function buildParsed(opts: {
    messageId?: string | null;
    subject?: string;
    text?: string;
    fromEmail?: string;
    toAddress?: string;
    deliveredTo?: string | null;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
      size?: number;
    }>;
  }): ParsedMail {
    const headers = new Map<string, unknown>();
    if (opts.deliveredTo !== null && opts.deliveredTo !== undefined) {
      headers.set('delivered-to', opts.deliveredTo);
    }
    return {
      messageId:
        opts.messageId === null
          ? undefined
          : (opts.messageId ?? '<msg-001@example.com>'),
      subject: opts.subject ?? 'Test subject',
      text: opts.text ?? 'Hello world',
      html: undefined,
      from: opts.fromEmail
        ? {
            value: [{ address: opts.fromEmail, name: '' }],
            text: opts.fromEmail,
            html: '',
          }
        : undefined,
      to: opts.toAddress
        ? {
            value: [{ address: opts.toAddress, name: '' }],
            text: opts.toAddress,
            html: '',
          }
        : undefined,
      headers,
      attachments: opts.attachments ?? [],
    } as unknown as ParsedMail;
  }

  it('создаёт Issue из письма с alias в To + помечает лог created', async () => {
    mailInboundFindUnique.mockResolvedValueOnce(null);
    projectFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      tenantId: 'org_1',
      ownerId: 'u_owner',
      emailInboxEnabled: true,
      deletedAt: null,
    });
    issuesCreate.mockResolvedValueOnce({ id: 'iss_1' });

    const parsed = buildParsed({
      messageId: '<msg-create@x>',
      subject: 'Новый запрос',
      text: 'Текст письма',
      fromEmail: 'sender@example.com',
      toAddress: 'project-abc123@inbox.kora.app',
    });

    const outcome = await service.processOne(parsed);
    expect(outcome).toBe('created');

    expect(projectFindUnique).toHaveBeenCalledWith({
      where: { emailInboxAlias: 'project-abc123' },
      select: expect.any(Object),
    });
    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const call = issuesCreate.mock.calls[0] ?? [];
    const [projectId, dto, tenantId, userId] = call;
    expect(projectId).toBe('p_1');
    expect(tenantId).toBe('org_1');
    expect(userId).toBe('u_owner');
    expect(dto.title).toBe('Новый запрос');
    expect(dto.description).toBe('Текст письма');
    expect(dto.externalSource).toBe('email');
    expect(dto.externalId).toBe('msg-create@x');

    // Создался успешный лог created с issueId.
    expect(mailInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'org_1',
        projectId: 'p_1',
        messageId: 'msg-create@x',
        status: 'created',
        issueId: 'iss_1',
      }),
    });
    expect(metrics.incMailInboundIssueCreated).toHaveBeenCalled();
  });

  it('сохраняет вложения в S3 и создаёт IssueAttachment', async () => {
    mailInboundFindUnique.mockResolvedValueOnce(null);
    projectFindUnique.mockResolvedValueOnce({
      id: 'p_2',
      tenantId: 'org_2',
      ownerId: 'u_owner2',
      emailInboxEnabled: true,
      deletedAt: null,
    });
    issuesCreate.mockResolvedValueOnce({ id: 'iss_2' });

    const attachContent = Buffer.from('binary-pdf-content');
    const parsed = buildParsed({
      messageId: '<msg-att@x>',
      toAddress: 'project-with-att@inbox.kora.app',
      fromEmail: 'a@b.com',
      attachments: [
        {
          filename: 'document.pdf',
          content: attachContent,
          contentType: 'application/pdf',
          size: attachContent.byteLength,
        },
      ],
    });

    const outcome = await service.processOne(parsed);
    expect(outcome).toBe('created');

    expect(s3PutObject).toHaveBeenCalledTimes(1);
    const s3Args = (s3PutObject.mock.calls[0] ?? [])[0];
    expect(s3Args.key).toMatch(
      /^mail-inbound\/org_2\/p_2\/msg-att_x\/document\.pdf$/,
    );
    expect(s3Args.contentType).toBe('application/pdf');
    expect(s3Args.body).toBe(attachContent);

    expect(issueAttachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueId: 'iss_2',
        fileName: 'document.pdf',
        mimeType: 'application/pdf',
        uploaderId: 'u_owner2',
      }),
    });
    expect(metrics.incMailInboundAttachmentUploaded).toHaveBeenCalled();
  });

  it('bounce при alias не найден (Project.findUnique=null)', async () => {
    mailInboundFindUnique.mockResolvedValueOnce(null);
    projectFindUnique.mockResolvedValueOnce(null);

    const parsed = buildParsed({
      messageId: '<msg-bounce@x>',
      toAddress: 'project-missing@inbox.kora.app',
      fromEmail: 'sender@x.com',
    });

    const outcome = await service.processOne(parsed);
    expect(outcome).toBe('bounced');
    expect(issuesCreate).not.toHaveBeenCalled();
    expect(mailInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'bounced',
        reason: 'alias_not_found',
        projectId: null,
      }),
    });
    expect(metrics.incMailInboundBounce).toHaveBeenCalledWith({
      reason: 'alias_not_found',
    });
  });

  it('bounce при emailInboxEnabled=false', async () => {
    mailInboundFindUnique.mockResolvedValueOnce(null);
    projectFindUnique.mockResolvedValueOnce({
      id: 'p_disabled',
      tenantId: 'org_3',
      ownerId: 'u_owner3',
      emailInboxEnabled: false,
      deletedAt: null,
    });

    const parsed = buildParsed({
      messageId: '<msg-disabled@x>',
      toAddress: 'project-off@inbox.kora.app',
      fromEmail: 'sender@x.com',
    });

    const outcome = await service.processOne(parsed);
    expect(outcome).toBe('bounced');
    expect(issuesCreate).not.toHaveBeenCalled();
    expect(mailInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'bounced',
        reason: 'disabled',
        projectId: 'p_disabled',
      }),
    });
    expect(metrics.incMailInboundBounce).toHaveBeenCalledWith({
      reason: 'disabled',
    });
  });

  it('идемпотентность: повторная обработка того же Message-ID → duplicate, без create', async () => {
    // mailInboundLog.findUnique вернёт существующую запись.
    mailInboundFindUnique.mockResolvedValueOnce({ id: 'old', status: 'created' });

    const parsed = buildParsed({
      messageId: '<msg-dup@x>',
      toAddress: 'project-xyz@inbox.kora.app',
      fromEmail: 'a@b.com',
    });

    const outcome = await service.processOne(parsed);
    expect(outcome).toBe('duplicate');
    expect(issuesCreate).not.toHaveBeenCalled();
    expect(mailInboundCreate).not.toHaveBeenCalled();
    expect(projectFindUnique).not.toHaveBeenCalled();
  });

  it('игнорирует адреса с чужим доменом (alias=null → bounce no_alias_in_to)', async () => {
    mailInboundFindUnique.mockResolvedValueOnce(null);

    const parsed = buildParsed({
      messageId: '<msg-wrong-domain@x>',
      toAddress: 'someone@other-domain.example',
      fromEmail: 'a@b.com',
    });

    const outcome = await service.processOne(parsed);
    expect(outcome).toBe('bounced');
    expect(projectFindUnique).not.toHaveBeenCalled();
    expect(mailInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'bounced',
        reason: 'no_alias_in_to',
      }),
    });
  });
});
