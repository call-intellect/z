import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { IntegrationsStatusResponseDto } from '../dto/overview/integrations-status-response.dto';

import { ProjectsService } from './projects.service';

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
    const project = await this.projects.requireProject(args.projectId, args.tenantId);

    const mailDomain = this.cfg.mailInbox.domain;
    const emailToTask = {
      enabled: project.emailInboxEnabled && Boolean(project.emailInboxAlias),
      alias:
        project.emailInboxEnabled && project.emailInboxAlias
          ? `${project.emailInboxAlias}@${mailDomain}`
          : null,
    };

    const telegramSubscription = {
      isActive: false,
      telegramLinked: false,
    };

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
