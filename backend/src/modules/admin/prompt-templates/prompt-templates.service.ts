/**
 * Фаза A.2 — AdminPromptTemplatesService.
 *
 * CRUD и version-management для PromptTemplate / PromptTemplateVersion /
 * PromptTemplateSection. Источник: ТЗ A §7.1.
 *
 * Бизнес-правила:
 *   - Системные шаблоны (scope=system) — только super_admin может создавать,
 *     править и удалять. Org-Admin может только скопировать в свой Org.
 *   - Org-шаблоны (scope=org) — orgId обязателен; key уникален в рамках Org.
 *   - При сохранении новой версии: создаётся новая PromptTemplateVersion
 *     с versionNumber = max(versionNumber)+1. activeVersionId не меняется,
 *     пока не вызвали activate-version.
 *   - Валидация суммы maxTokens на сохранении ≤ 16000 (ТЗ §15).
 *   - soft-delete: status → archived, deletedAt → now(). Системные защищены
 *     от полного удаления; Org-шаблоны можно удалить полностью.
 *
 * RBAC: контроллер делает базовый super_admin-чек через SuperAdminGuard.
 * Owner/admin Org проверяется в А.3 (там же entitlement-гейт). В А.2
 * Org-операции доступны super_admin'у (как и системные).
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  type MeetingType,
  type PromptTemplate,
  type PromptTemplateSection,
  type PromptTemplateStatus,
  type PromptTemplateVersion,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { EntitlementService } from '../../entitlements/entitlement.service';

import type {
  CopyToOrgDto,
  CreatePromptTemplateDto,
  CreatePromptVersionDto,
  ListPromptTemplatesQueryDto,
  SectionInputDto,
  UpdatePromptTemplateDto,
} from './dto/prompt-templates.dto';

/** Лимит суммы maxTokens всех секций одной версии (ТЗ §15). */
export const SECTIONS_MAX_TOKENS_SUM = 16000;
export const SECTIONS_MAX_COUNT = 30;

/**
 * Фаза A.3 — RBAC-контекст вызывающего пользователя. Передаётся в методы
 * мутации. Для super_admin'а — bypass всех проверок. Для owner/admin —
 * проверяется, что шаблон принадлежит одной из его Org.
 */
export interface PromptTemplateRbacContext {
  userId: string;
  isSuperAdmin: boolean;
  /** Org, в которых пользователь owner/admin. */
  ownedOrgIds: string[];
}

export type TemplateWithRelations = PromptTemplate & {
  versions: PromptTemplateVersion[];
  activeVersion: (PromptTemplateVersion & { sections: PromptTemplateSection[] }) | null;
};

@Injectable()
export class AdminPromptTemplatesService {
  private readonly logger = new Logger(AdminPromptTemplatesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // Optional ради лёгких unit-тестов сервиса (entitlement-проверка может быть
    // замокана пустыми возвратами).
    @Optional()
    @Inject(EntitlementService)
    private readonly entitlements?: EntitlementService,
  ) {}

  // ─── list & detail ─────────────────────────────────────────────────

  async list(
    filters: ListPromptTemplatesQueryDto,
    rbac?: PromptTemplateRbacContext,
  ): Promise<{
    items: PromptTemplate[];
  }> {
    const where: Prisma.PromptTemplateWhereInput = {
      deletedAt: null,
      ...(filters.scope ? { scope: filters.scope } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.meetingType ? { meetingType: filters.meetingType } : {}),
      ...(filters.taskType ? { taskType: filters.taskType } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' as const } },
              { key: { contains: filters.search, mode: 'insensitive' as const } },
              { description: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    // Фаза A.3 — RBAC-фильтрация: не-super_admin видит только system + свои Org.
    if (rbac && !rbac.isSuperAdmin) {
      where.OR = [
        ...(where.OR ?? []),
        { scope: 'system' },
        { scope: 'org', orgId: { in: rbac.ownedOrgIds } },
      ];
      // Если поиск задан, OR конфликтует. В таком случае объединяем через AND.
      if (filters.search) {
        const searchOr = where.OR.slice(0, 1); // первый — поиск
        const accessOr = where.OR.slice(1);
        delete where.OR;
        where.AND = [
          { OR: searchOr },
          { OR: accessOr },
        ];
      }
    }
    const items = await this.prisma.promptTemplate.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      include: { activeVersion: { select: { id: true, versionNumber: true } } },
    });
    return { items };
  }

  async detail(id: string): Promise<TemplateWithRelations> {
    const tpl = await this.prisma.promptTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            createdAt: true,
            createdById: true,
            notes: true,
            templateId: true,
            systemPrompt: true,
            outputSchema: true,
            toolName: true,
          },
        },
        activeVersion: {
          include: { sections: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!tpl || tpl.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'prompt_template_not_found', id },
      });
    }
    return tpl as TemplateWithRelations;
  }

  async getVersion(
    templateId: string,
    versionId: string,
  ): Promise<PromptTemplateVersion & { sections: PromptTemplateSection[] }> {
    const v = await this.prisma.promptTemplateVersion.findFirst({
      where: { id: versionId, templateId },
      include: { sections: { orderBy: { order: 'asc' } } },
    });
    if (!v) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'prompt_version_not_found', templateId, versionId },
      });
    }
    return v;
  }

  // ─── create / update / delete ──────────────────────────────────────

  async create(
    dto: CreatePromptTemplateDto,
    userId: string,
    rbac?: PromptTemplateRbacContext,
  ): Promise<TemplateWithRelations> {
    if (dto.scope === 'org' && !dto.orgId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'org_id_required_for_scope_org' },
      });
    }
    const orgId = dto.scope === 'org' ? dto.orgId! : null;

    // ── Фаза A.3 — RBAC + entitlement-гейт ────────────────────────────
    if (rbac && !rbac.isSuperAdmin) {
      if (dto.scope === 'system') {
        throw new ForbiddenException({
          ok: false,
          error: { code: 'system_scope_super_admin_only' },
        });
      }
      if (dto.scope === 'org' && (!orgId || !rbac.ownedOrgIds.includes(orgId))) {
        throw new ForbiddenException({
          ok: false,
          error: { code: 'no_access_to_org', orgId: orgId ?? null },
        });
      }
    }
    if (dto.scope === 'org' && orgId) {
      await this.assertOrgCanCreateTemplate(orgId);
    }

    // Уникальность (orgId, key) — проверим явно ради читаемой ошибки.
    const dup = await this.prisma.promptTemplate.findFirst({
      where: { orgId, key: dto.key, deletedAt: null },
    });
    if (dup) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'prompt_template_key_already_exists', key: dto.key },
      });
    }

    const hasInitialVersion =
      dto.systemPrompt !== undefined && dto.sections !== undefined;
    if (hasInitialVersion) {
      this.assertSectionsValid(dto.sections!);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const tpl = await tx.promptTemplate.create({
        data: {
          scope: dto.scope,
          orgId,
          key: dto.key,
          name: dto.name,
          description: dto.description ?? null,
          meetingType: (dto.meetingType ?? null) as MeetingType | null,
          taskType: dto.taskType,
          status: 'draft' as PromptTemplateStatus,
          createdById: userId,
          editedByAdmin: false,
        },
      });
      if (hasInitialVersion) {
        const version = await tx.promptTemplateVersion.create({
          data: {
            templateId: tpl.id,
            versionNumber: 1,
            systemPrompt: dto.systemPrompt!,
            outputSchema: (dto.outputSchema ?? { type: 'object', properties: {} }) as Prisma.InputJsonValue,
            toolName: dto.toolName ?? null,
            createdById: userId,
          },
        });
        if (dto.sections && dto.sections.length > 0) {
          await tx.promptTemplateSection.createMany({
            data: dto.sections.map((s, idx) => ({
              versionId: version.id,
              order: s.order ?? idx + 1,
              key: s.key,
              title: s.title,
              instruction: s.instruction,
              outputType: s.outputType,
              required: s.required,
              maxTokens: s.maxTokens ?? null,
            })),
          });
        }
        // Не активируем по умолчанию — шаблон остаётся draft до явного activate.
      }
      return tpl;
    });

    this.logger.log(
      { id: created.id, scope: created.scope, orgId, key: created.key, userId },
      'prompt-template created',
    );
    return this.detail(created.id);
  }

  async update(
    id: string,
    dto: UpdatePromptTemplateDto,
    _userId: string,
    rbac?: PromptTemplateRbacContext,
  ): Promise<TemplateWithRelations> {
    const tpl = await this.detail(id);
    this.assertCanMutate(tpl, rbac);
    await this.prisma.promptTemplate.update({
      where: { id: tpl.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.meetingType !== undefined
          ? { meetingType: (dto.meetingType ?? null) as MeetingType | null }
          : {}),
        ...(dto.taskType !== undefined ? { taskType: dto.taskType } : {}),
        editedByAdmin: true,
      },
    });
    return this.detail(tpl.id);
  }

  async softDelete(
    id: string,
    userId: string,
    rbac?: PromptTemplateRbacContext,
  ): Promise<{ ok: true }> {
    const tpl = await this.detail(id);
    if (tpl.scope === 'system') {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'cannot_delete_system_template' },
      });
    }
    this.assertCanMutate(tpl, rbac);
    await this.prisma.promptTemplate.update({
      where: { id: tpl.id },
      data: { deletedAt: new Date(), status: 'archived' as PromptTemplateStatus },
    });
    this.logger.log({ id, userId }, 'prompt-template soft-deleted');
    return { ok: true };
  }

  // ─── version create / activate ─────────────────────────────────────

  async createVersion(
    templateId: string,
    dto: CreatePromptVersionDto,
    userId: string,
    rbac?: PromptTemplateRbacContext,
  ): Promise<{
    version: PromptTemplateVersion & { sections: PromptTemplateSection[] };
    activated: boolean;
  }> {
    const tpl = await this.detail(templateId);
    this.assertCanMutate(tpl, rbac);
    this.assertSectionsValid(dto.sections);

    const last = await this.prisma.promptTemplateVersion.findFirst({
      where: { templateId: tpl.id },
      orderBy: { versionNumber: 'desc' },
    });
    const nextNumber = (last?.versionNumber ?? 0) + 1;

    const version = await this.prisma.$transaction(async (tx) => {
      const v = await tx.promptTemplateVersion.create({
        data: {
          templateId: tpl.id,
          versionNumber: nextNumber,
          systemPrompt: dto.systemPrompt,
          outputSchema: (dto.outputSchema ?? { type: 'object', properties: {} }) as Prisma.InputJsonValue,
          toolName: dto.toolName ?? null,
          createdById: userId,
          notes: dto.notes ?? null,
        },
      });
      if (dto.sections.length > 0) {
        await tx.promptTemplateSection.createMany({
          data: dto.sections.map((s, idx) => ({
            versionId: v.id,
            order: s.order ?? idx + 1,
            key: s.key,
            title: s.title,
            instruction: s.instruction,
            outputType: s.outputType,
            required: s.required,
            maxTokens: s.maxTokens ?? null,
          })),
        });
      }
      await tx.promptTemplate.update({
        where: { id: tpl.id },
        data: { editedByAdmin: true },
      });
      return v;
    });

    const reloaded = await this.getVersion(tpl.id, version.id);

    let activated = false;
    if (dto.activate) {
      await this.activateVersion(tpl.id, version.id);
      activated = true;
    }
    this.logger.log(
      { templateId: tpl.id, versionId: version.id, versionNumber: nextNumber, userId, activated },
      'prompt-template version created',
    );
    return { version: reloaded, activated };
  }

  async activateVersion(
    templateId: string,
    versionId: string,
    rbac?: PromptTemplateRbacContext,
  ): Promise<{ ok: true }> {
    const tpl = await this.detail(templateId);
    this.assertCanMutate(tpl, rbac);
    const version = await this.prisma.promptTemplateVersion.findFirst({
      where: { id: versionId, templateId: tpl.id },
    });
    if (!version) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'prompt_version_not_found', templateId, versionId },
      });
    }
    await this.prisma.promptTemplate.update({
      where: { id: tpl.id },
      data: {
        activeVersionId: version.id,
        status: 'active' as PromptTemplateStatus,
        editedByAdmin: true,
      },
    });
    this.logger.log({ templateId, versionId }, 'prompt-template version activated');
    return { ok: true };
  }

  // ─── copy-to-org ───────────────────────────────────────────────────

  async copyToOrg(
    templateId: string,
    dto: CopyToOrgDto,
    userId: string,
    rbac?: PromptTemplateRbacContext,
  ): Promise<TemplateWithRelations> {
    const src = await this.detail(templateId);
    // Фаза A.3 — не-super_admin может копировать только в свою Org + entitlement.
    if (rbac && !rbac.isSuperAdmin) {
      if (!rbac.ownedOrgIds.includes(dto.orgId)) {
        throw new ForbiddenException({
          ok: false,
          error: { code: 'no_access_to_org', orgId: dto.orgId },
        });
      }
    }
    await this.assertOrgCanCreateTemplate(dto.orgId);
    if (!src.activeVersionId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'cannot_copy_template_without_active_version' },
      });
    }
    const active = await this.prisma.promptTemplateVersion.findUnique({
      where: { id: src.activeVersionId },
      include: { sections: { orderBy: { order: 'asc' } } },
    });
    if (!active) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'active_version_missing' },
      });
    }
    const newKey = dto.key ?? `${src.key}-copy`;
    const newName = dto.name ?? `${src.name} (копия)`;

    // Уникальность (orgId, key) — проверим явно.
    const dup = await this.prisma.promptTemplate.findFirst({
      where: { orgId: dto.orgId, key: newKey, deletedAt: null },
    });
    if (dup) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'prompt_template_key_already_exists', key: newKey },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const tpl = await tx.promptTemplate.create({
        data: {
          scope: 'org',
          orgId: dto.orgId,
          key: newKey,
          name: newName,
          description: src.description,
          meetingType: src.meetingType,
          taskType: src.taskType,
          status: 'draft' as PromptTemplateStatus,
          createdById: userId,
        },
      });
      const v = await tx.promptTemplateVersion.create({
        data: {
          templateId: tpl.id,
          versionNumber: 1,
          systemPrompt: active.systemPrompt,
          outputSchema: active.outputSchema as Prisma.InputJsonValue,
          toolName: active.toolName,
          createdById: userId,
          notes: `Скопирован из шаблона ${src.key} (версия ${active.versionNumber})`,
        },
      });
      if (active.sections.length > 0) {
        await tx.promptTemplateSection.createMany({
          data: active.sections.map((s) => ({
            versionId: v.id,
            order: s.order,
            key: s.key,
            title: s.title,
            instruction: s.instruction,
            outputType: s.outputType,
            required: s.required,
            maxTokens: s.maxTokens,
          })),
        });
      }
      return tpl;
    });

    this.logger.log(
      { srcId: src.id, newId: created.id, orgId: dto.orgId, userId },
      'prompt-template copied to org',
    );
    return this.detail(created.id);
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /**
   * Фаза A.3 — проверка, что вызывающий пользователь имеет право мутировать
   * данный шаблон.
   *
   *   - super_admin → всегда true.
   *   - не-super_admin → только если scope='org' и orgId в ownedOrgIds.
   *   - системные шаблоны (scope='system') — нельзя мутировать не-super_admin'ом.
   *
   * Если `rbac` не передан (вызов из тестов/старого кода) — пропускаем проверку.
   */
  assertCanMutate(
    tpl: { scope: string; orgId: string | null },
    rbac?: PromptTemplateRbacContext,
  ): void {
    if (!rbac) return;
    if (rbac.isSuperAdmin) return;
    if (tpl.scope === 'system') {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'system_template_super_admin_only' },
      });
    }
    if (tpl.scope === 'org' && tpl.orgId && rbac.ownedOrgIds.includes(tpl.orgId)) {
      return;
    }
    throw new ForbiddenException({
      ok: false,
      error: { code: 'no_access_to_template', orgId: tpl.orgId ?? null },
    });
  }

  /**
   * Фаза A.3 — entitlement-гейт на создание Org-шаблона.
   *
   * Проверяет:
   *   1) `feature.custom_prompt_templates` включена для Org.
   *   2) Лимит `prompt_templates_per_org` не превышен (текущее число
   *      Org-шаблонов с deletedAt=null < лимит).
   */
  private async assertOrgCanCreateTemplate(orgId: string): Promise<void> {
    if (!this.entitlements) return;
    const hasFeature = await this.entitlements.hasFeature(
      orgId,
      'feature.custom_prompt_templates',
    );
    if (!hasFeature) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'feature_not_available',
          feature: 'feature.custom_prompt_templates',
          message: 'Доступно на тарифе Pro/Business',
        },
      });
    }
    const limit = await this.entitlements.getQuota(orgId, 'prompt_templates_per_org');
    if (limit <= 0) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'org_template_quota_zero',
          message: 'На вашем тарифе нельзя создавать шаблоны',
        },
      });
    }
    const currentCount = await this.prisma.promptTemplate.count({
      where: { scope: 'org', orgId, deletedAt: null },
    });
    if (currentCount >= limit) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'org_template_quota_exceeded',
          limit,
          current: currentCount,
        },
      });
    }
  }

  /**
   * Валидация секций: лимит количества и суммарных maxTokens (ТЗ §15).
   * Уникальность order/key проверяет БД (unique-constraints), здесь —
   * раннее обнаружение дублей.
   */
  private assertSectionsValid(sections: SectionInputDto[]): void {
    if (sections.length > SECTIONS_MAX_COUNT) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'too_many_sections', max: SECTIONS_MAX_COUNT, got: sections.length },
      });
    }
    const sumMaxTokens = sections.reduce(
      (acc, s) => acc + (s.maxTokens ?? 0),
      0,
    );
    if (sumMaxTokens > SECTIONS_MAX_TOKENS_SUM) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'sections_max_tokens_exceeded',
          limit: SECTIONS_MAX_TOKENS_SUM,
          got: sumMaxTokens,
        },
      });
    }
    const keys = new Set<string>();
    const orders = new Set<number>();
    for (const s of sections) {
      if (keys.has(s.key)) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'duplicate_section_key', key: s.key },
        });
      }
      keys.add(s.key);
      if (s.order !== undefined) {
        if (orders.has(s.order)) {
          throw new BadRequestException({
            ok: false,
            error: { code: 'duplicate_section_order', order: s.order },
          });
        }
        orders.add(s.order);
      }
    }
  }
}
