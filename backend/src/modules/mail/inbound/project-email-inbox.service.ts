import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * DTO ответа API: per-project email-inbox + последние логи.
 */
export interface ProjectEmailInboxDto {
  projectId: string;
  enabled: boolean;
  alias: string | null;
  fullAddress: string | null;
  recentLogs: MailInboundLogDto[];
}

export interface MailInboundLogDto {
  id: string;
  messageId: string;
  fromEmail: string;
  subject: string;
  status: 'received' | 'bounced' | 'failed' | 'created';
  reason: string | null;
  issueId: string | null;
  createdAt: string;
}

/**
 * ProjectEmailInboxService (Tracker Phase 4, T5).
 *
 * Управление per-project email-inbox:
 *  - `get(projectId)` — текущий alias + recent логи.
 *  - `enable(projectId)` — генерирует alias (если нет), включает.
 *  - `regenerate(projectId)` — генерирует новый alias (старый забывается).
 *  - `disable(projectId)` — снимает флаг (alias сохраняется на случай возврата).
 *
 * Alias-формат: `project-${nanoid(10)}` — глобально уникален (БД-constraint
 * `@@unique` на `Project.emailInboxAlias` исключает коллизии).
 *
 * Tenant ownership проверяется caller'ом (контроллер через RBAC + lookup
 * проекта). Здесь — только бизнес-логика.
 */
@Injectable()
export class ProjectEmailInboxService {
  private readonly logger = new Logger(ProjectEmailInboxService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async get(projectId: string, tenantId: string): Promise<ProjectEmailInboxDto> {
    const project = await this.requireProject(projectId, tenantId);
    const logs = await this.prisma.mailInboundLog.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
    });
    return this.toResponse(project, logs);
  }

  async enable(
    projectId: string,
    tenantId: string,
  ): Promise<ProjectEmailInboxDto> {
    const project = await this.requireProject(projectId, tenantId);
    const alias = project.emailInboxAlias ?? (await this.allocateUniqueAlias());
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { emailInboxAlias: alias, emailInboxEnabled: true },
    });
    this.logger.log(
      { projectId, alias, tenantId },
      'project-email-inbox: включён',
    );
    return this.toResponse(updated, []);
  }

  async disable(
    projectId: string,
    tenantId: string,
  ): Promise<ProjectEmailInboxDto> {
    const project = await this.requireProject(projectId, tenantId);
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { emailInboxEnabled: false },
    });
    this.logger.log(
      { projectId, tenantId, previousAlias: project.emailInboxAlias },
      'project-email-inbox: выключен (alias сохранён)',
    );
    return this.toResponse(updated, []);
  }

  /**
   * Регенерация alias. Старый alias освобождается (уходит в null), что:
   *  - сразу же делает входящие на старый адрес → bounced (alias_not_found);
   *  - освобождает alias для других проектов (теоретически — но коллизия
   *    маловероятна, alias генерируется случайно из 10 символов).
   */
  async regenerate(
    projectId: string,
    tenantId: string,
  ): Promise<ProjectEmailInboxDto> {
    await this.requireProject(projectId, tenantId);
    const newAlias = await this.allocateUniqueAlias();
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { emailInboxAlias: newAlias, emailInboxEnabled: true },
    });
    this.logger.log(
      { projectId, newAlias, tenantId },
      'project-email-inbox: alias регенерирован',
    );
    return this.toResponse(updated, []);
  }

  // ── internal ──

  private async requireProject(projectId: string, tenantId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, tenantId, deletedAt: null },
    });
    if (!p) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'project_not_found', message: 'Проект не найден' },
      });
    }
    return p;
  }

  /**
   * Генерирует уникальный alias `project-XXXXXXXXXX` (10 hex-chars).
   * Retry до 5 раз на коллизию (вероятность ничтожна, но safety-net).
   */
  private async allocateUniqueAlias(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const alias = `project-${randomBytes(5).toString('hex')}`;
      const existing = await this.prisma.project.findUnique({
        where: { emailInboxAlias: alias },
        select: { id: true },
      });
      if (!existing) return alias;
    }
    throw new ConflictException({
      ok: false,
      error: {
        code: 'alias_allocation_failed',
        message: 'Не удалось сгенерировать уникальный alias (5 попыток)',
      },
    });
  }

  private toResponse(
    project: {
      id: string;
      emailInboxAlias: string | null;
      emailInboxEnabled: boolean;
    },
    logs: Array<{
      id: string;
      messageId: string;
      fromEmail: string;
      subject: string;
      status: 'received' | 'bounced' | 'failed' | 'created';
      reason: string | null;
      issueId: string | null;
      createdAt: Date;
    }>,
  ): ProjectEmailInboxDto {
    const domain = this.cfg.mailInbox.domain;
    const fullAddress = project.emailInboxAlias
      ? `${project.emailInboxAlias}@${domain}`
      : null;
    return {
      projectId: project.id,
      enabled: project.emailInboxEnabled,
      alias: project.emailInboxAlias,
      fullAddress,
      recentLogs: logs.map((l) => ({
        id: l.id,
        messageId: l.messageId,
        fromEmail: l.fromEmail,
        subject: l.subject,
        status: l.status,
        reason: l.reason,
        issueId: l.issueId,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }
}
