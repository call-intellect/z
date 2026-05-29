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
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import type { MyCloneAccessResponseDto } from './dto/clone-access-grant.dto';
import {
  CloneConversationsQuerySchema,
  type CloneConversationsQuery,
  type CloneConversationsListResponseDto,
} from './dto/clone-conversations.dto';
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
import { ClonesAdminService } from './services/clones-admin.service';
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
  constructor(
    @Inject(ClonesService) private readonly clones: ClonesService,
    // audit В17 (2026-05-29): для requestAccess (in-app сигнал admin'ам).
    @Inject(ClonesAdminService) private readonly admin: ClonesAdminService,
  ) {}

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

  @Get('conversations')
  @ApiOperation({
    summary:
      'ТЗ 2026-05-26 §2.7: список диалогов текущего пользователя с клоном (для боковой панели /clones UI)',
  })
  async listMyCloneConversations(
    @Query(new ZodValidationPipe(CloneConversationsQuerySchema))
    query: CloneConversationsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CloneConversationsListResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.clones.listMyCloneConversations({
      tenantId: t,
      requesterUserId: user.id,
      cloneType: query.cloneType,
      cloneRefId: query.cloneRefId,
      limit: query.limit,
      cursor: query.cursor,
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
  @RequireSubscription()
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
  @RequireSubscription()
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
  @RequireSubscription()
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
  @RequireSubscription()
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

  // ──────── audit В17 (2026-05-29) — request access (in-app сигнал admin'ам) ────────

  @Post('roles/:roleId/access-grants/request')
  @ApiOperation({
    summary:
      'audit В17: член Org запрашивает доступ к клону роли. Уведомляет всех admin/owner через conversational notification (eventType=clone.access_requested). Возвращает {ok:false, reason:"already_granted"} если у юзера уже есть активный grant.',
  })
  async requestRoleAccess(
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const t = this.requireTenant(tenantId);
    return this.admin.requestAccess({
      tenantId: t,
      requesterUserId: user.id,
      cloneType: 'role',
      cloneRefId: roleId,
    });
  }

  @Post('persons/:personId/access-grants/request')
  @ApiOperation({
    summary:
      'audit В17: член Org запрашивает доступ к клону конкретного сотрудника. См. requestRoleAccess.',
  })
  async requestPersonAccess(
    @Param('personId') personId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const t = this.requireTenant(tenantId);
    return this.admin.requestAccess({
      tenantId: t,
      requesterUserId: user.id,
      cloneType: 'person',
      cloneRefId: personId,
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
  @RequireSubscription()
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
  @RequireSubscription()
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

/**
 * ТЗ 2026-05-26 (clone-access-grant-admin-api) §2.6 — user-эндпоинт
 * `GET /api/v1/me/clone-access`. Возвращает id-ы активных грантов текущего
 * пользователя в текущем тенанте (без enrichment — фронт сам мапит, имея
 * уже загруженный список клонов).
 *
 * Не admin-эндпоинт: доступен любому залогиненному member'у Org. Используется
 * фронтом для оптимистичной фильтрации карточек в маркетплейсе клонов
 * (`useMyCloneAccess()` hook).
 *
 * Отдельный @Controller-класс с префиксом `api/v1/me` — чтобы сохранить путь
 * без префикса `/clones`. Регистрируется в `ClonesModule` рядом с
 * `ClonesController`.
 */
@ApiTags('clones')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MeCloneAccessController {
  constructor(
    @Inject(ClonesAdminService)
    private readonly admin: ClonesAdminService,
  ) {}

  @Get('clone-access')
  @ApiOperation({
    summary:
      'ТЗ 2026-05-26 §2.6: id-ы активных грантов на клонов для текущего пользователя.',
  })
  async getMyCloneAccess(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MyCloneAccessResponseDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return this.admin.getMyCloneAccess({ tenantId, userId: user.id });
  }
}
