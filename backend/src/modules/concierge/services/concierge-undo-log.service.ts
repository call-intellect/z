import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type ConciergeUndoLog, Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ServiceMapGeneratorService,
  type ToolSchema,
} from './service-map-generator.service';
import { ToolRouterService } from './tool-router.service';

/**
 * SBA γ-2 — ConciergeUndoLogService.
 *
 * Хранит executed tool calls с rollback-инструкциями.
 *
 *   - `record(...)` — пишет лог после успешного tool execution.
 *   - `undo(logId, userId, tenantId, baseUrl, authCookie)` — выполняет rollback
 *     через ToolRouterService (вызывает undoableVia tool с теми же args или
 *     transformed).
 */
@Injectable()
export class ConciergeUndoLogService {
  private readonly logger = new Logger(ConciergeUndoLogService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ServiceMapGeneratorService)
    private readonly serviceMap: ServiceMapGeneratorService,
    @Inject(ToolRouterService) private readonly toolRouter: ToolRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Зафиксировать выполненный tool call. Если у tool'а есть `undoableVia` —
   * сохраняем инструкцию для последующего rollback'а.
   */
  async record(args: {
    tenantId: string;
    conversationId: string;
    tool: ToolSchema;
    params: Record<string, unknown>;
    result: unknown;
  }): Promise<ConciergeUndoLog> {
    const undoInstruction = args.tool.undoableVia
      ? {
          undoTool: args.tool.undoableVia,
          // По умолчанию переиспользуем те же args + id из result (если есть).
          inheritedParams: args.params,
          resultIdHint: this.extractIdFromResult(args.result),
        }
      : null;

    return this.prisma.conciergeUndoLog.create({
      data: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        toolName: args.tool.name,
        paramsJson: args.params as unknown as Prisma.InputJsonValue,
        resultJson: (args.result ?? null) as unknown as Prisma.InputJsonValue,
        undoInstructionJson: undoInstruction
          ? (undoInstruction as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
  }

  /**
   * Выполнить rollback. Tool, на который ссылается undoInstruction.undoTool,
   * должен присутствовать в whitelist; RBAC проверяется как при обычном
   * execute.
   */
  async undo(args: {
    logId: string;
    tenantId: string;
    userId: string;
    baseUrl: string;
    authCookie?: string;
  }): Promise<{ ok: boolean; status: number; message?: string }> {
    const log = await this.prisma.conciergeUndoLog.findFirst({
      where: { id: args.logId, tenantId: args.tenantId },
    });
    if (!log) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'undo_log_not_found', message: 'Undo-log не найден' },
      });
    }
    if (log.rolledBackAt) {
      return { ok: false, status: 409, message: 'Действие уже отменено' };
    }
    if (!log.undoInstructionJson) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'undo_not_available',
          message: 'Это действие нельзя отменить',
        },
      });
    }

    const instr = log.undoInstructionJson as {
      undoTool: string;
      inheritedParams?: Record<string, unknown>;
      resultIdHint?: string | null;
    };

    const undoToolName = instr.undoTool;
    const args0: Record<string, unknown> = {
      ...(instr.inheritedParams ?? {}),
    };
    if (instr.resultIdHint && !args0.id) {
      args0.id = instr.resultIdHint;
    }

    const execResult = await this.toolRouter.execute({
      toolName: undoToolName,
      args: args0,
      tenantId: args.tenantId,
      userId: args.userId,
      baseUrl: args.baseUrl,
      authCookie: args.authCookie,
    });

    if (execResult.ok) {
      await this.prisma.conciergeUndoLog.update({
        where: { id: log.id },
        data: { rolledBackAt: new Date() },
      });
      this.metrics.incConciergeUndo?.({
        tenantTop: this.tenantTop(args.tenantId),
        tool: log.toolName,
      });
      return { ok: true, status: 200 };
    }
    return {
      ok: false,
      status: execResult.status,
      message: execResult.errorMessage ?? 'rollback failed',
    };
  }

  // ──────────────────────────── private ────────────────────────────────

  /**
   * Попытаться извлечь `id` из result для подстановки в undoTool. Поддерживаем
   * самые частые формы: { id }, { data: { id } }, { meeting: { id } }.
   */
  private extractIdFromResult(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (typeof r.id === 'string') return r.id;
    for (const v of Object.values(r)) {
      if (v && typeof v === 'object') {
        const inner = (v as Record<string, unknown>).id;
        if (typeof inner === 'string') return inner;
      }
    }
    return null;
  }

  private tenantTop(tenantId: string): string {
    let h = 0;
    for (let i = 0; i < tenantId.length; i++) {
      h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
    }
    return `bucket_${(h % 100).toString().padStart(2, '0')}`;
  }
}
