import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';

export class WorkerDisabledForOrgError extends Error {
  readonly code = 'worker_disabled_for_org';
  constructor(workerName: string, tenantId: string) {
    super(`worker_disabled_for_org: ${workerName} for tenant=${tenantId}`);
    this.name = 'WorkerDisabledForOrgError';
  }
}

@Injectable()
export class WorkerOrgGate {
  private readonly logger = new Logger(WorkerOrgGate.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly config: TypedConfigService,
  ) {}

  async checkOrThrow(tenantId: string | null, workerName: string): Promise<void> {
    if (!tenantId) return;
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { workersEnabled: true, deletedAt: true, demoWorkspaceSeededAt: true },
    });
    if (!org) {
      return;
    }
    if (org.deletedAt) {
      throw new WorkerDisabledForOrgError(workerName, tenantId);
    }
    if (
      org.demoWorkspaceSeededAt !== null &&
      !this.config.resolveSync<boolean>(
        'knowledge.demoOrgIngestEnabled',
        'KNOWLEDGE_DEMO_ORG_INGEST_ENABLED',
        true,
      )
    ) {
      this.logger.debug(
        `gate: demo-org ingest OFF → skip ${workerName} for tenant=${tenantId}`,
      );
      throw new WorkerDisabledForOrgError(workerName, tenantId);
    }
    const map = (org.workersEnabled ?? {}) as Record<string, unknown>;
    if (map[workerName] === false) {
      this.logger.debug(`gate: ${workerName} disabled for tenant=${tenantId} → fail-job`);
      throw new WorkerDisabledForOrgError(workerName, tenantId);
    }
  }

  static isEnabled(
    workersEnabled: Record<string, unknown> | null | undefined,
    workerName: string,
  ): boolean {
    if (!workersEnabled) return true;
    return workersEnabled[workerName] !== false;
  }
}
