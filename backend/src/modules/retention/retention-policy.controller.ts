import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { RetentionPolicyService } from './retention-policy.service';

const ARCHIVED_BLOCK_ACTIONS = ['archive_then_delete', 'keep_forever'] as const;

const PatchRetentionSchema = z
  .object({
    rawEventDays: z.coerce.number().int().min(30).max(36500).optional(),
    archivedBlockDays: z.coerce.number().int().min(1).max(36500).optional(),
    chatMessageDays: z.coerce.number().int().min(7).max(36500).optional(),
    auditLogDays: z.coerce.number().int().min(1).max(36500).optional(),
    archivedBlockAction: z.enum(ARCHIVED_BLOCK_ACTIONS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'тело должно содержать хотя бы одно поле',
  });

type PatchRetentionDto = z.infer<typeof PatchRetentionSchema>;

interface RetentionPolicyResponseDto {
  tenantId: string;
  rawEventDays: number;
  archivedBlockDays: number;
  chatMessageDays: number;
  auditLogDays: number;
  archivedBlockAction: string;
  lastSweepAt: string | null;
  updatedAt: string;
}

@ApiTags('settings')
@Controller('api/v1/settings/retention')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RetentionPolicyController {
  constructor(
    @Inject(RetentionPolicyService) private readonly svc: RetentionPolicyService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Текущая retention-политика Org (owner-only)' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RetentionPolicyResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireOwner(user.id, t);
    const policy = await this.svc.getOrInit(t);
    return this.toDto(policy);
  }

  @Patch()
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Обновить retention-политику Org (owner-only)' })
  async patch(
    @Body(new ZodValidationPipe(PatchRetentionSchema)) body: PatchRetentionDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RetentionPolicyResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireOwner(user.id, t);

    const before = await this.svc.getOrInit(t);
    const updated = await this.svc.update(t, body);

    void this.audit.log({
      userId: user.id,
      action: AUDIT.RETENTION_POLICY_UPDATED,
      resourceId: updated.id,
      metadata: {
        tenantId: t,
        before: {
          rawEventDays: before.rawEventDays,
          archivedBlockDays: before.archivedBlockDays,
          chatMessageDays: before.chatMessageDays,
          auditLogDays: before.auditLogDays,
          archivedBlockAction: before.archivedBlockAction,
        },
        after: {
          rawEventDays: updated.rawEventDays,
          archivedBlockDays: updated.archivedBlockDays,
          chatMessageDays: updated.chatMessageDays,
          auditLogDays: updated.auditLogDays,
          archivedBlockAction: updated.archivedBlockAction,
        },
      },
    });

    return this.toDto(updated);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireOwner(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canManageOrg(userId, tenantId);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Управление retention-политикой доступно только владельцу Org или super_admin.',
        },
      });
    }
  }

  private toDto(p: {
    tenantId: string;
    rawEventDays: number;
    archivedBlockDays: number;
    chatMessageDays: number;
    auditLogDays: number;
    archivedBlockAction: string;
    lastSweepAt: Date | null;
    updatedAt: Date;
  }): RetentionPolicyResponseDto {
    return {
      tenantId: p.tenantId,
      rawEventDays: p.rawEventDays,
      archivedBlockDays: p.archivedBlockDays,
      chatMessageDays: p.chatMessageDays,
      auditLogDays: p.auditLogDays,
      archivedBlockAction: p.archivedBlockAction,
      lastSweepAt: p.lastSweepAt ? p.lastSweepAt.toISOString() : null,
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
