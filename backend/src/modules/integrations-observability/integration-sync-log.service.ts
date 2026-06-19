import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export type IntegrationProvider = 'bitrix' | 'chatbox';
export type IntegrationSyncKind = 'sync' | 'analyze';

export interface IntegrationSyncRunMeta {
  tenantId: string;
  provider: IntegrationProvider;
  kind: IntegrationSyncKind;
  scope?: string | null;
  refId?: string | null;
}

export interface IntegrationSyncRunHandle {
  id: string;
  startedMs: number;
}

@Injectable()
export class IntegrationSyncLogService {
  private readonly logger = new Logger(IntegrationSyncLogService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async begin(meta: IntegrationSyncRunMeta): Promise<IntegrationSyncRunHandle | null> {
    const startedMs = Date.now();
    try {
      const row = await this.prisma.integrationSyncRun.create({
        data: {
          tenantId: meta.tenantId,
          provider: meta.provider,
          kind: meta.kind,
          scope: meta.scope ?? null,
          refId: meta.refId ?? null,
          status: 'running',
        },
        select: { id: true },
      });
      return { id: row.id, startedMs };
    } catch (err) {
      this.warn('begin', err);
      return null;
    }
  }

  async succeed(
    handle: IntegrationSyncRunHandle | null,
    counts?: Record<string, unknown> | null,
  ): Promise<void> {
    await this.finalize(handle, 'success', counts ?? null, null);
  }

  async fail(handle: IntegrationSyncRunHandle | null, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.finalize(handle, 'failed', null, message);
  }

  async skip(handle: IntegrationSyncRunHandle | null, reason?: string | null): Promise<void> {
    await this.finalize(handle, 'skipped', null, reason ?? null);
  }

  private async finalize(
    handle: IntegrationSyncRunHandle | null,
    status: 'success' | 'failed' | 'skipped',
    counts: Record<string, unknown> | null,
    error: string | null,
  ): Promise<void> {
    if (!handle) return;
    try {
      await this.prisma.integrationSyncRun.update({
        where: { id: handle.id },
        data: {
          status,
          finishedAt: new Date(),
          durationMs: Math.max(0, Date.now() - handle.startedMs),
          ...(counts !== null ? { counts: counts as Prisma.InputJsonValue } : {}),
          ...(error !== null ? { error: error.slice(0, 2000) } : {}),
        },
      });
    } catch (err) {
      this.warn('finalize', err);
    }
  }

  private warn(op: string, err: unknown): void {
    this.logger.warn(
      { op, err: err instanceof Error ? err.message : String(err) },
      'IntegrationSyncLog: запись не удалась (best-effort, синк не прерван)',
    );
  }
}
