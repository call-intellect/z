import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
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
import { RbacService, type ResourceType } from '../rbac/rbac.service';

import {
  CreateAuthorityBoundarySchema,
  CreateDecisionPolicySchema,
  CreateInteractionSchema,
  CreateRequiredKnowledgeSchema,
  CreateResponsibilityElementSchema,
  UpdateAuthorityBoundarySchema,
  UpdateDecisionPolicySchema,
  UpdateInteractionSchema,
  UpdateRequiredKnowledgeSchema,
  UpdateResponsibilityElementSchema,
  type AuthorityBoundaryDto,
  type CreateAuthorityBoundaryDto,
  type CreateDecisionPolicyDto,
  type CreateInteractionDto,
  type CreateRequiredKnowledgeDto,
  type CreateResponsibilityElementDto,
  type DecisionPolicyDto,
  type InteractionDto,
  type RequiredKnowledgeDto,
  type ResponsibilityElementDto,
  type RoleMapDto,
  type RoleMaturityDto,
  type UpdateAuthorityBoundaryDto,
  type UpdateDecisionPolicyDto,
  type UpdateInteractionDto,
  type UpdateRequiredKnowledgeDto,
  type UpdateResponsibilityElementDto,
} from './dto/role-map.dto';
import { AuthorityBoundaryService } from './services/authority-boundary.service';
import { DecisionPolicyService } from './services/decision-policy.service';
import { InteractionService } from './services/interaction.service';
import { RequiredKnowledgeService } from './services/required-knowledge.service';
import { ResponsibilityElementService } from './services/responsibility-element.service';
import { RoleMapBuilderService } from './services/role-map-builder.service';

/**
 * SBA α-8 wave 4 — REST API карты должности.
 *
 *   GET    /api/v1/roles/:id/map
 *   GET    /api/v1/roles/:id/maturity
 *
 *   GET    /api/v1/roles/:id/responsibilities
 *   POST   /api/v1/roles/:id/responsibilities
 *   PATCH  /api/v1/roles/:id/responsibilities/:itemId
 *   DELETE /api/v1/roles/:id/responsibilities/:itemId
 *
 *   GET    /api/v1/roles/:id/authority
 *   POST   /api/v1/roles/:id/authority
 *   PATCH  /api/v1/roles/:id/authority/:itemId
 *   DELETE /api/v1/roles/:id/authority/:itemId
 *
 *   GET    /api/v1/roles/:id/knowledge
 *   POST   /api/v1/roles/:id/knowledge
 *   PATCH  /api/v1/roles/:id/knowledge/:itemId
 *   DELETE /api/v1/roles/:id/knowledge/:itemId
 *
 *   GET    /api/v1/roles/:id/decision-policies
 *   POST   /api/v1/roles/:id/decision-policies
 *   PATCH  /api/v1/roles/:id/decision-policies/:itemId
 *   DELETE /api/v1/roles/:id/decision-policies/:itemId
 *
 *   GET    /api/v1/roles/:id/interactions
 *   POST   /api/v1/roles/:id/interactions
 *   PATCH  /api/v1/roles/:id/interactions/:itemId
 *   DELETE /api/v1/roles/:id/interactions/:itemId
 *
 * RBAC ResourceType: `role` для read, `role` для write/delete. Per-category
 * permissions проверяются через RBAC + дополнительные правила в сервисах
 * (всё внутри одного Org).
 *
 * NB: используем существующий RBAC ResourceType `role` (см. policy.csv).
 * Per-category resourceTypes (`role.map.read`, `role.responsibility.write` и т.п.)
 * упоминались в ТЗ как future-work; на wave 4 ограничиваемся `role` ресурсом,
 * проверки одинаковые: owner/admin r/w/d, manager r.
 */
@ApiTags('roles-map')
@Controller('api/v1/roles')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RoleMapController {
  constructor(
    @Inject(RoleMapBuilderService)
    private readonly builder: RoleMapBuilderService,
    @Inject(ResponsibilityElementService)
    private readonly responsibilities: ResponsibilityElementService,
    @Inject(AuthorityBoundaryService)
    private readonly authority: AuthorityBoundaryService,
    @Inject(RequiredKnowledgeService)
    private readonly knowledge: RequiredKnowledgeService,
    @Inject(DecisionPolicyService)
    private readonly decisions: DecisionPolicyService,
    @Inject(InteractionService)
    private readonly interactions: InteractionService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ─────────────────────────── Aggregate ──────────────────────────────

  @Get(':id/map')
  @ApiOperation({ summary: 'Карта должности (5 категорий + KPI + completeness)' })
  async getMap(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleMapDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.builder.getMap({ tenantId: t, roleId: id });
  }

  @Get(':id/maturity')
  @ApiOperation({ summary: 'Maturity-сводка должности (для drill-down)' })
  async getMaturity(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleMaturityDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.builder.getMaturity({ tenantId: t, roleId: id });
  }

  // ─────────────────────────── Responsibilities ───────────────────────

  @Get(':id/responsibilities')
  @ApiOperation({ summary: 'Список элементов ответственности' })
  async listResponsibilities(
    @Param('id') roleId: string,
    @Query('kind') kind: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: ResponsibilityElementDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.responsibilities.listByRole({
      tenantId: t,
      roleId,
      kind: kind as never,
    });
    return { items };
  }

  @Post(':id/responsibilities')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать элемент ответственности' })
  async createResponsibility(
    @Param('id') roleId: string,
    @Body(new ZodValidationPipe(CreateResponsibilityElementSchema))
    body: CreateResponsibilityElementDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ResponsibilityElementDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.responsibilities.create({
      tenantId: t,
      userId: user.id,
      roleId,
      body,
    });
  }

  @Patch(':id/responsibilities/:itemId')
  @ApiOperation({ summary: 'Обновить элемент ответственности' })
  async updateResponsibility(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateResponsibilityElementSchema))
    body: UpdateResponsibilityElementDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ResponsibilityElementDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.responsibilities.update({
      tenantId: t,
      userId: user.id,
      id: itemId,
      body,
    });
  }

  @Delete(':id/responsibilities/:itemId')
  @ApiOperation({ summary: 'Удалить элемент ответственности (soft)' })
  async deleteResponsibility(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.responsibilities.softDelete({
      tenantId: t,
      userId: user.id,
      id: itemId,
    });
  }

  // ─────────────────────────── Authority ──────────────────────────────

  @Get(':id/authority')
  @ApiOperation({ summary: 'Границы полномочий (allowed/requires_approval/forbidden)' })
  async listAuthority(
    @Param('id') roleId: string,
    @Query('kind') kind: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: AuthorityBoundaryDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.authority.listByRole({
      tenantId: t,
      roleId,
      kind: kind as never,
    });
    return { items };
  }

  @Post(':id/authority')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать границу полномочий' })
  async createAuthority(
    @Param('id') roleId: string,
    @Body(new ZodValidationPipe(CreateAuthorityBoundarySchema))
    body: CreateAuthorityBoundaryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AuthorityBoundaryDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.authority.create({
      tenantId: t,
      userId: user.id,
      roleId,
      body,
    });
  }

  @Patch(':id/authority/:itemId')
  @ApiOperation({ summary: 'Обновить границу полномочий' })
  async updateAuthority(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateAuthorityBoundarySchema))
    body: UpdateAuthorityBoundaryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AuthorityBoundaryDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.authority.update({
      tenantId: t,
      userId: user.id,
      id: itemId,
      body,
    });
  }

  @Delete(':id/authority/:itemId')
  @ApiOperation({ summary: 'Удалить границу полномочий (soft)' })
  async deleteAuthority(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.authority.softDelete({
      tenantId: t,
      userId: user.id,
      id: itemId,
    });
  }

  // ─────────────────────────── Required Knowledge ─────────────────────

  @Get(':id/knowledge')
  @ApiOperation({ summary: 'Требования к знаниям' })
  async listKnowledge(
    @Param('id') roleId: string,
    @Query('importance') importance: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: RequiredKnowledgeDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.knowledge.listByRole({
      tenantId: t,
      roleId,
      importance: importance as never,
    });
    return { items };
  }

  @Post(':id/knowledge')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать требование к знаниям' })
  async createKnowledge(
    @Param('id') roleId: string,
    @Body(new ZodValidationPipe(CreateRequiredKnowledgeSchema))
    body: CreateRequiredKnowledgeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RequiredKnowledgeDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.knowledge.create({
      tenantId: t,
      userId: user.id,
      roleId,
      body,
    });
  }

  @Patch(':id/knowledge/:itemId')
  @ApiOperation({ summary: 'Обновить требование к знаниям' })
  async updateKnowledge(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateRequiredKnowledgeSchema))
    body: UpdateRequiredKnowledgeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RequiredKnowledgeDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.knowledge.update({
      tenantId: t,
      userId: user.id,
      id: itemId,
      body,
    });
  }

  @Delete(':id/knowledge/:itemId')
  @ApiOperation({ summary: 'Удалить требование к знаниям (soft)' })
  async deleteKnowledge(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.knowledge.softDelete({
      tenantId: t,
      userId: user.id,
      id: itemId,
    });
  }

  // ─────────────────────────── Decision Policies ─────────────────────

  @Get(':id/decision-policies')
  @ApiOperation({ summary: 'Политики принятия решений' })
  async listDecisionPolicies(
    @Param('id') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: DecisionPolicyDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.decisions.listByRole({
      tenantId: t,
      roleId,
    });
    return { items };
  }

  @Post(':id/decision-policies')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать политику принятия решений' })
  async createDecisionPolicy(
    @Param('id') roleId: string,
    @Body(new ZodValidationPipe(CreateDecisionPolicySchema))
    body: CreateDecisionPolicyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DecisionPolicyDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.decisions.create({
      tenantId: t,
      userId: user.id,
      roleId,
      body,
    });
  }

  @Patch(':id/decision-policies/:itemId')
  @ApiOperation({ summary: 'Обновить политику принятия решений' })
  async updateDecisionPolicy(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateDecisionPolicySchema))
    body: UpdateDecisionPolicyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DecisionPolicyDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.decisions.update({
      tenantId: t,
      userId: user.id,
      id: itemId,
      body,
    });
  }

  @Delete(':id/decision-policies/:itemId')
  @ApiOperation({ summary: 'Удалить политику принятия решений (soft)' })
  async deleteDecisionPolicy(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.decisions.softDelete({
      tenantId: t,
      userId: user.id,
      id: itemId,
    });
  }

  // ─────────────────────────── Interactions ──────────────────────────

  @Get(':id/interactions')
  @ApiOperation({ summary: 'Взаимодействия должности (reports_to / collaborates_with / ...)' })
  async listInteractions(
    @Param('id') roleId: string,
    @Query('kind') kind: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: InteractionDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.interactions.listByRole({
      tenantId: t,
      roleId,
      kind,
    });
    return { items };
  }

  @Post(':id/interactions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать взаимодействие' })
  async createInteraction(
    @Param('id') roleId: string,
    @Body(new ZodValidationPipe(CreateInteractionSchema))
    body: CreateInteractionDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<InteractionDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.interactions.create({
      tenantId: t,
      userId: user.id,
      roleId,
      body,
    });
  }

  @Patch(':id/interactions/:itemId')
  @ApiOperation({ summary: 'Обновить взаимодействие' })
  async updateInteraction(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateInteractionSchema))
    body: UpdateInteractionDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<InteractionDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.interactions.update({
      tenantId: t,
      userId: user.id,
      id: itemId,
      body,
    });
  }

  @Delete(':id/interactions/:itemId')
  @ApiOperation({ summary: 'Удалить взаимодействие (soft)' })
  async deleteInteraction(
    @Param('id') _roleId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.interactions.softDelete({
      tenantId: t,
      userId: user.id,
      id: itemId,
    });
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'role' as ResourceType);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет прав на чтение должности' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'role' as ResourceType);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Изменять карту должности может только владелец/администратор Org',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'role' as ResourceType,
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Удалять элементы карты должности может только владелец/администратор Org',
        },
      });
    }
  }
}
