import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { IntegrationsStatusResponseDto } from '../dto/overview/integrations-status-response.dto';

import { ProjectsService } from './projects.service';

/**
 * Tracker Project Overview Часть 3 (2026-05-27) — «Приложения».
 *
 * Возвращает best-effort снимок состояния интеграций проекта:
 *  - Email-to-task (Project.emailInboxEnabled + alias).
 *  - Telegram-уведомления проекта (модель `ProjectTelegramSubscription` в этом
 *    ТЗ не реализована — возвращаем `isActive=false`; флаг `telegramLinked`
 *    смотрит наличие telegram-аккаунта у пользователя — модели нет, оставляем
 *    `false`).
 *  - Webhooks count (IssueWebhook per tenant — у нас нет projectId-фильтра в
 *    модели, поэтому возвращаем общий счёт активных webhook'ов).
 *  - Last import — последний ImportLog для tenant'а (модель не хранит
 *    projectId; вернём последний на org).
 *
 * Все «отсутствует/0/null» — это норма: UI рендерит карточку «Не настроено».
 */
@Injectable()
export class IntegrationsStatusService {
  private readonly logger = new Logger(IntegrationsStatusService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getStatus(args: {
    projectId: string;
    tenantId: string;
    userId: string;
  }): Promise<IntegrationsStatusResponseDto> {
    const project = await this.projects.requireProject(
      args.projectId,
      args.tenantId,
    );

    // 1. Email-to-task.
    const mailDomain = this.cfg.mailInbox.domain;
    const emailToTask = {
      enabled: project.emailInboxEnabled && Boolean(project.emailInboxAlias),
      alias:
        project.emailInboxEnabled && project.emailInboxAlias
          ? `${project.emailInboxAlias}@${mailDomain}`
          : null,
    };

    // 2. Telegram subscription. Модель `ProjectTelegramSubscription` пока не
    // существует — ТЗ предусматривает её создание в Phase 2, но в этом ТЗ
    // мы только показываем витрину карточек. Возвращаем безопасные default'ы.
    // TODO(tracker-project-overview-phase-2): когда появится модель, читать
    // её здесь по (projectId, userId).
    const telegramSubscription = {
      isActive: false,
      telegramLinked: false,
    };

    // 3. Webhooks. У IssueWebhook нет projectId — считаем активные на tenant.
    let webhooksCount = 0;
    try {
      webhooksCount = await this.prisma.issueWebhook.count({
        where: { tenantId: args.tenantId, isActive: true },
      });
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IntegrationsStatusService: issueWebhook.count failed, fallback 0',
      );
    }

    // 4. Last import — ImportLog последний завершённый.
    let lastImport: IntegrationsStatusResponseDto['lastImport'] = null;
    try {
      const log = await this.prisma.importLog.findFirst({
        where: { tenantId: args.tenantId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { source: true, completedAt: true },
      });
      if (log?.completedAt) {
        lastImport = {
          source: log.source,
          completedAt: log.completedAt.toISOString(),
        };
      }
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IntegrationsStatusService: importLog.findFirst failed, fallback null',
      );
    }

    return {
      emailToTask,
      telegramSubscription,
      webhooksCount,
      lastImport,
    };
  }
}
