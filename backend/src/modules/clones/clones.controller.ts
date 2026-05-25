import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import {
  AskCloneBodySchema,
  ClonesListQuerySchema,
  MarkTraitMisleadingBodySchema,
  type AskCloneBody,
  type AskCloneResponseDto,
  type CloneHistoryResponseDto,
  type ClonesListQuery,
  type ClonesListResponseDto,
  type CreateCloneConversationResponseDto,
  type MarkTraitMisleadingBody,
  type SkillProfileDto,
  type RoleSkillProfileDto,
} from './dto/clones.dto';
import { ClonesService } from './services/clones.service';

/**
 * SBA γ-1 — REST API Clone (γ-1.9).
 *
 *   POST /api/v1/clones/persons/:personId/ask — ответ от клона сотрудника.
 *   POST /api/v1/clones/roles/:roleId/ask     — ответ от клона роли.
 *
 * RBAC: внутри ClonesService.canAccessPersonClone (owner/admin/self/direct manager).
 * Rate limit: cfg.skill.cloneAskPerUserPerDay (default 20) на пользователя в день.
 */
@ApiTags('clones')
@Controller('api/v1/clones')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ClonesController {
  constructor(@Inject(ClonesService) private readonly clones: ClonesService) {}

  // ─────── Clones=Roles Ф4 — list + history (новые ролевые эндпоинты) ───────

  @Get()
  @ApiOperation({
    summary:
      'Clones=Roles Ф4: список текущих ролевых клонов Org (для /clones UI)',
  })
  async listClones(
    @Query(new ZodValidationPipe(ClonesListQuerySchema))
    query: ClonesListQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ClonesListResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.listClones({
      tenantId: t,
      requesterUserId: user.id,
      query,
    });
  }

  @Get(':roleId/history')
  @ApiOperation({
    summary:
      'Clones=Roles Ф4: история версий клона роли (для /roles/:id/clone/history)',
  })
  async getCloneHistory(
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CloneHistoryResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.getCloneHistory({
      tenantId: t,
      requesterUserId: user.id,
      roleId,
    });
  }

  @Post('persons/:personId/conversations')
  @ApiOperation({
    summary:
      'ТЗ §9.4.7: создать новый пустой диалог с клоном сотрудника (кнопка «Новый диалог»)',
  })
  async createPersonConversation(
    @Param('personId') personId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CreateCloneConversationResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.createCloneConversation({
      tenantId: t,
      requesterUserId: user.id,
      cloneType: 'person',
      cloneRefId: personId,
    });
  }

  @Post('roles/:roleId/conversations')
  @ApiOperation({
    summary:
      'ТЗ §9.4.7: создать новый пустой диалог с клоном роли (кнопка «Новый диалог»)',
  })
  async createRoleConversation(
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CreateCloneConversationResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.createCloneConversation({
      tenantId: t,
      requesterUserId: user.id,
      cloneType: 'role',
      cloneRefId: roleId,
    });
  }

  @Post('persons/:personId/ask')
  @ApiOperation({
    summary: 'Спросить клона конкретного сотрудника',
  })
  async askPerson(
    @Param('personId') personId: string,
    @Body(new ZodValidationPipe(AskCloneBodySchema)) body: AskCloneBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AskCloneResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.askPerson({
      tenantId: t,
      requesterUserId: user.id,
      personId,
      question: body.question,
      conversationId: body.conversationId,
    });
  }

  @Post('roles/:roleId/ask')
  @ApiOperation({
    summary: 'Спросить клона роли (агрегат по сотрудникам этой должности)',
  })
  async askRole(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(AskCloneBodySchema)) body: AskCloneBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AskCloneResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.askRole({
      tenantId: t,
      requesterUserId: user.id,
      roleId,
      question: body.question,
      conversationId: body.conversationId,
    });
  }

  @Get('persons/:personId/skill-profile')
  @ApiOperation({
    summary: 'Навыковый профиль сотрудника (для manager / admin / self)',
  })
  async getPersonSkillProfile(
    @Param('personId') personId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SkillProfileDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.getPersonSkillProfile({
      tenantId: t,
      requesterUserId: user.id,
      personId,
    });
  }

  @Get('roles/:roleId/skill-profile')
  @ApiOperation({
    summary: 'Агрегатный навыковый профиль роли (топ-черт по сотрудникам)',
  })
  async getRoleSkillProfile(
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleSkillProfileDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.getRoleSkillProfile({
      tenantId: t,
      requesterUserId: user.id,
      roleId,
    });
  }

  @Post('persons/:personId/persona/snapshot')
  @ApiOperation({
    summary:
      'SBA γ-1 доделки — manual snapshot ExecutablePersona (носитель или admin/owner Org)',
  })
  async triggerManualPersonaSnapshot(
    @Param('personId') personId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    built: boolean;
    personaId: string | null;
    reason: string | null;
  }> {
    const t = this.requireTenant(tenantId);
    return this.clones.triggerManualPersonaSnapshot({
      tenantId: t,
      requesterUserId: user.id,
      personId,
    });
  }

  @Post('skill-traits/:traitId/mark-misleading')
  @ApiOperation({
    summary: 'Пометить черту в навыковом профиле как неверную',
  })
  async markTraitMisleading(
    @Param('traitId') traitId: string,
    @Body(new ZodValidationPipe(MarkTraitMisleadingBodySchema))
    body: MarkTraitMisleadingBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.clones.markTraitMisleading({
      tenantId: t,
      requesterUserId: user.id,
      traitId,
      reason: body.reason ?? '',
    });
    return { ok: true };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }
}
