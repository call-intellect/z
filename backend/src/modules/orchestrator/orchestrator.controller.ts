import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  PostOrchestratorRunBodySchema,
  type PostOrchestratorRunBodyDto,
} from './dto/orchestrator.dto';
import { readOrchestratorLimits } from './orchestrator.config';
import { OrchestratorService } from './services/orchestrator.service';

@ApiTags('orchestrator')
@Controller('api/v1/orchestrator')
@UseGuards(CookieAuthGuard, TenantGuard)
export class OrchestratorController {
  constructor(
    @Inject(OrchestratorService)
    private readonly orchestrator: OrchestratorService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Post('runs')
  @ApiOperation({
    summary: 'Запустить multi-agent research-run (SSE stream событий)',
  })
  async runStream(
    @Body(new ZodValidationPipe(PostOrchestratorRunBodySchema))
    body: PostOrchestratorRunBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch {}
    }, 15_000);

    try {
      for await (const event of this.orchestrator.run({
        task: body.task,
        tenantId: t,
        userId: user.id,
        ...(body.depth !== undefined ? { depth: body.depth } : {}),
      })) {
        if (res.writableEnded) break;
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({ type: 'error', code: 'stream_failure', message })}\n\n`,
        );
      } catch {}
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Статус research-run + результат' })
  async get(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    id: string;
    tenantId: string;
    userId: string;
    task: string;
    status: string;
    planJson: unknown;
    synthesisJson: unknown;
    verificationJson: unknown;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
    jobs: Array<{
      id: string;
      stepIndex: number;
      agentType: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
      errorMessage: string | null;
    }>;
  }> {
    const t = this.requireTenant(tenantId);
    const run = await this.prisma.orchestratorRun.findFirst({
      where: { id, tenantId: t },
      include: {
        jobs: { orderBy: { stepIndex: 'asc' } },
      },
    });
    if (!run) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Research-run не найден' },
      });
    }
    await this.requireRead(user.id, t, run.userId);

    return {
      id: run.id,
      tenantId: run.tenantId,
      userId: run.userId,
      task: run.task,
      status: run.status,
      planJson: run.planJson,
      synthesisJson: run.synthesisJson,
      verificationJson: run.verificationJson,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      jobs: run.jobs.map((j) => ({
        id: j.id,
        stepIndex: j.stepIndex,
        agentType: j.agentType,
        status: j.status,
        startedAt: j.startedAt ? j.startedAt.toISOString() : null,
        completedAt: j.completedAt ? j.completedAt.toISOString() : null,
        errorMessage: j.errorMessage,
      })),
    };
  }

  @Get('runs/:id/events')
  @ApiOperation({
    summary: 'Re-stream SSE-событий run-а (текущее состояние из БД)',
  })
  async events(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    const run = await this.prisma.orchestratorRun.findFirst({
      where: { id, tenantId: t },
      include: { jobs: { orderBy: { stepIndex: 'asc' } } },
    });
    if (!run) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Research-run не найден' },
      });
    }
    await this.requireRead(user.id, t, run.userId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const write = (eventType: string, payload: unknown) => {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    write('started', { type: 'started', runId: run.id });
    if (run.planJson) {
      write('plan', { type: 'plan', plan: run.planJson });
    }
    for (const j of run.jobs) {
      write('subagent_started', {
        type: 'subagent_started',
        stepIndex: j.stepIndex,
        agentType: j.agentType,
        description: '',
      });
      if (j.status === 'done' || j.status === 'failed') {
        const result = j.resultJson as { text?: string } | null;
        write('subagent_completed', {
          type: 'subagent_completed',
          stepIndex: j.stepIndex,
          agentType: j.agentType,
          ok: j.status === 'done',
          preview: (result?.text ?? j.errorMessage ?? '').slice(0, 280),
        });
      }
    }
    if (run.synthesisJson) {
      write('synthesis', { type: 'synthesis', synthesis: run.synthesisJson });
    }
    if (run.verificationJson) {
      write('verification', {
        type: 'verification',
        verification: run.verificationJson,
      });
    }
    if (run.status === 'done') {
      write('done', { type: 'done', runId: run.id });
    } else if (run.status === 'failed') {
      write('error', {
        type: 'error',
        code: 'run_failed',
        message: run.errorMessage ?? 'run failed',
      });
    }
    res.end();
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отменить research-run' })
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; status: string }> {
    const t = this.requireTenant(tenantId);
    const run = await this.prisma.orchestratorRun.findFirst({
      where: { id, tenantId: t },
    });
    if (!run) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Research-run не найден' },
      });
    }
    await this.requireWrite(user.id, t, run.userId);

    if (run.status === 'done' || run.status === 'failed') {
      return { ok: true, status: run.status };
    }
    await this.prisma.orchestratorRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'cancelled by user',
      },
    });
    await this.prisma.orchestratorSubagentJob.updateMany({
      where: { runId: run.id, status: { in: ['pending', 'running'] } },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'cancelled by user',
      },
    });
    return { ok: true, status: 'failed' };
  }

  private requireTenant(t: string | undefined): string {
    if (!t) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Не удалось определить организацию (X-Org-Id не передан)',
        },
      });
    }
    return t;
  }

  private async requireWrite(
    userId: string,
    tenantId: string,
    resourceOwnerId?: string | null,
  ): Promise<void> {
    const limits = readOrchestratorLimits(this.cfg);
    if (!limits.enabled) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'orchestrator_disabled',
          message: 'Orchestrator выключен в этой среде (ORCHESTRATOR_ENABLED=false)',
        },
      });
    }
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'orchestrator',
      act: 'write',
      resourceOwnerId: resourceOwnerId ?? userId,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для запуска research-run',
        },
      });
    }
  }

  private async requireRead(
    userId: string,
    tenantId: string,
    resourceOwnerId: string,
  ): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'orchestrator',
      act: 'read',
      resourceOwnerId,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для просмотра research-run',
        },
      });
    }
  }
}
