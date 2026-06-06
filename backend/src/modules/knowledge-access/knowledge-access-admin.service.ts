import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { KnowledgeAccessResolver } from '../rbac/knowledge-access-resolver.service';

import type { ClosedGroupKind } from './dto/knowledge-access.dto';

/**
 * KnowledgeAccessAdminService — управление доступом к знаниям через группы
 * (ТЗ 2026-06-06 knowledge-access-groups, Фаза 7 часть A).
 *
 * Все методы tenant-scoped: `tenantId` передаётся из контроллера (@CurrentOrg);
 * проверка прав owner/admin делается guard'ом `OrgAdminGuard`.
 *
 * КРИТИЧНО: любая мутация членства/матрицы зовёт
 * `KnowledgeAccessResolver.invalidateAll()`, иначе кэш групп (TTL 60с) отдаёт
 * устаревший доступ. Изменения групп редкие — глобальная инвалидация дешевле
 * и безопаснее точечной.
 */
@Injectable()
export class KnowledgeAccessAdminService {
  private readonly logger = new Logger(KnowledgeAccessAdminService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
  ) {}

  // ─────────────────────────── группы ─────────────────────────────────────

  /** Список групп Org с числом участников (для UI). */
  async listGroups(tenantId: string): Promise<{
    items: Array<{
      id: string;
      kind: string;
      name: string;
      isClosed: boolean;
      refId: string | null;
      memberCount: number;
    }>;
  }> {
    const groups = await this.prisma.knowledgeGroup.findMany({
      where: { tenantId },
      select: {
        id: true,
        kind: true,
        name: true,
        isClosed: true,
        refId: true,
        _count: { select: { members: true } },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return {
      items: groups.map((g) => ({
        id: g.id,
        kind: g.kind,
        name: g.name,
        isClosed: g.isClosed,
        refId: g.refId,
        memberCount: g._count.members,
      })),
    };
  }

  // ─────────────────────────── матрица видимости ──────────────────────────

  /** Все политики видимости Org (+ имена групп для UI). */
  async getMatrix(tenantId: string): Promise<{
    items: Array<{
      subjectGroupId: string;
      subjectGroupName: string;
      visibleGroupId: string;
      visibleGroupName: string;
    }>;
  }> {
    const [policies, groups] = await Promise.all([
      this.prisma.groupVisibilityPolicy.findMany({
        where: { tenantId },
        select: { subjectGroupId: true, visibleGroupId: true },
      }),
      this.prisma.knowledgeGroup.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      }),
    ]);
    const nameById = new Map(groups.map((g) => [g.id, g.name]));
    return {
      items: policies.map((p) => ({
        subjectGroupId: p.subjectGroupId,
        subjectGroupName: nameById.get(p.subjectGroupId) ?? '',
        visibleGroupId: p.visibleGroupId,
        visibleGroupName: nameById.get(p.visibleGroupId) ?? '',
      })),
    };
  }

  /**
   * Направленно задать список видимых отделов для subject-группы.
   * Идемпотентно: удаляет старые политики subject-группы и создаёт новые.
   * Проверяет, что subject и все visible — department-группы этой Org.
   */
  async setMatrix(
    tenantId: string,
    subjectGroupId: string,
    visibleGroupIds: string[],
  ): Promise<{ ok: true; count: number }> {
    // Subject должна существовать в Org и быть department-группой.
    const subject = await this.prisma.knowledgeGroup.findFirst({
      where: { id: subjectGroupId, tenantId },
      select: { id: true, kind: true },
    });
    if (!subject) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'group_not_found',
          message: 'Группа-субъект не найдена в этой компании',
        },
      });
    }
    if (subject.kind !== 'department') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'subject_not_department',
          message: 'Матрица видимости применима только к отделам',
        },
      });
    }

    // Дедуп + исключаем self-ссылку (свой отдел и так доступен).
    const targetIds = [...new Set(visibleGroupIds)].filter(
      (id) => id !== subjectGroupId,
    );

    if (targetIds.length > 0) {
      const visible = await this.prisma.knowledgeGroup.findMany({
        where: { id: { in: targetIds }, tenantId, kind: 'department' },
        select: { id: true },
      });
      if (visible.length !== targetIds.length) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'visible_group_invalid',
            message:
              'Один или несколько видимых отделов не найдены или не являются отделом этой компании',
          },
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.groupVisibilityPolicy.deleteMany({
        where: { tenantId, subjectGroupId },
      });
      if (targetIds.length > 0) {
        await tx.groupVisibilityPolicy.createMany({
          data: targetIds.map((visibleGroupId) => ({
            tenantId,
            subjectGroupId,
            visibleGroupId,
          })),
          skipDuplicates: true,
        });
      }
    });

    this.accessResolver.invalidateAll();
    this.logger.log(
      `Матрица видимости обновлена: subject=${subjectGroupId} → ${targetIds.length} отделов (tenant=${tenantId})`,
    );
    return { ok: true, count: targetIds.length };
  }

  // ─────────────────────────── членство ───────────────────────────────────

  /** Список членов группы (personId, имя, источник). */
  async listMembers(
    tenantId: string,
    groupId: string,
  ): Promise<{
    items: Array<{ personId: string; personName: string; source: string }>;
  }> {
    await this.requireGroup(tenantId, groupId);
    const members = await this.prisma.knowledgeGroupMember.findMany({
      where: { groupId },
      select: { personId: true, source: true },
    });
    const personIds = members.map((m) => m.personId);
    const persons =
      personIds.length > 0
        ? await this.prisma.person.findMany({
            where: { id: { in: personIds }, tenantId },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(persons.map((p) => [p.id, p.name]));
    return {
      items: members.map((m) => ({
        personId: m.personId,
        personName: nameById.get(m.personId) ?? '',
        source: m.source,
      })),
    };
  }

  /**
   * Добавить человека в группу (source='manual'). Идемпотентно: повтор = no-op.
   * Используется и для clearance-override (поднять человека в leadership/council
   * без должности — это просто POST member в закрытую группу).
   */
  async addMember(
    tenantId: string,
    groupId: string,
    personId: string,
  ): Promise<{ ok: true; added: boolean }> {
    await this.requireGroup(tenantId, groupId);

    const person = await this.prisma.person.findFirst({
      where: { id: personId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Сотрудник не найден в этой компании',
        },
      });
    }

    const existing = await this.prisma.knowledgeGroupMember.findUnique({
      where: { groupId_personId: { groupId, personId } },
      select: { groupId: true },
    });
    if (existing) {
      return { ok: true, added: false };
    }

    await this.prisma.knowledgeGroupMember.create({
      data: { groupId, personId, source: 'manual' },
    });

    this.accessResolver.invalidateAll();
    this.logger.log(
      `Член добавлен в группу ${groupId}: person=${personId} (tenant=${tenantId})`,
    );
    return { ok: true, added: true };
  }

  /** Убрать человека из группы. Идемпотентно: нет строки = no-op. */
  async removeMember(
    tenantId: string,
    groupId: string,
    personId: string,
  ): Promise<{ ok: true; removed: boolean }> {
    await this.requireGroup(tenantId, groupId);

    const result = await this.prisma.knowledgeGroupMember.deleteMany({
      where: { groupId, personId },
    });

    this.accessResolver.invalidateAll();
    this.logger.log(
      `Член убран из группы ${groupId}: person=${personId} (removed=${result.count}, tenant=${tenantId})`,
    );
    return { ok: true, removed: result.count > 0 };
  }

  // ─────────────────────────── дефолт закрытости по типу ──────────────────

  /**
   * Admin-editable дефолт закрытости по типу встречи (крутилка).
   * Обновляет MeetingTypeConfig.defaultClosedGroupKind.
   */
  async setMeetingTypeClosedDefault(
    typeId: string,
    defaultClosedGroupKind: ClosedGroupKind,
    actorUserId: string,
  ): Promise<{ ok: true; typeId: string; defaultClosedGroupKind: ClosedGroupKind }> {
    const config = await this.prisma.meetingTypeConfig.findUnique({
      where: { id: typeId },
      select: { id: true },
    });
    if (!config) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'meeting_type_not_found',
          message: 'Тип встречи не найден',
        },
      });
    }

    await this.prisma.meetingTypeConfig.update({
      where: { id: typeId },
      data: { defaultClosedGroupKind, updatedBy: actorUserId },
    });

    this.logger.log(
      `Дефолт закрытости типа ${typeId} → ${defaultClosedGroupKind ?? 'открыто'} (actor=${actorUserId})`,
    );
    return { ok: true, typeId, defaultClosedGroupKind };
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  /** Проверка, что группа принадлежит Org; иначе 404. */
  private async requireGroup(tenantId: string, groupId: string): Promise<void> {
    const group = await this.prisma.knowledgeGroup.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'group_not_found',
          message: 'Группа не найдена в этой компании',
        },
      });
    }
  }
}
