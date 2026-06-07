import { Inject, Injectable, Logger } from '@nestjs/common';
import { type MembershipRole, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/** Тип closed-группы из источника (Meeting.closedGroupKind / type-default). */
type ClosedKind = 'leadership' | 'council' | 'personal';

/**
 * Ф3 (knowledge-access-groups-and-provenance, 2026-06-06) — детерминированный
 * вывод групп доступа блока (`IdeaBlockAccess`).
 *
 * ВАЖНО (инвариант ТЗ §Ф3): запись в `IdeaBlockAccess` идёт ВСЕГДА, НЕ за
 * enforcement-флагом — чтобы при будущем `KNOWLEDGE_ACCESS_ENFORCEMENT=enforce`
 * (Ф4) данные были готовы. Это байт-в-байт безопасно: ни один reader
 * `IdeaBlockAccess` ещё не существует (фильтр — Ф4). best-effort: ошибка
 * деривации НЕ валит ingest (как `attributeSubject`).
 */
@Injectable()
export class BlockAccessDeriverService {
  private readonly logger = new Logger(BlockAccessDeriverService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Выводит и записывает группы доступа блока (IdeaBlockAccess) детерминированно.
   * Идемпотентно (createMany skipDuplicates по @@id([blockId,groupId])).
   *   - department-группы: functional-метки (домен→DepartmentDomainLink→Department)
   *     ∪ отделы участников (meeting payload) ∪ отдел автора (subject-entity).
   *   - closed-группа: closedGroupKind встречи (payload) ?? MeetingTypeConfig
   *     .defaultClosedGroupKind(type). 'leadership'/'council' → синглтон;
   *     'personal' → персональная группа субъекта (+ members self/HR/owner),
   *     при неразрешимом субъекте — fallback 'leadership' (safe, не открыто).
   * best-effort — не бросает (логирует).
   */
  async deriveForBlock(args: {
    tenantId: string;
    blockId: string;
    sourceType: string;
    sourceExternalId: string;
    payload: unknown;
  }): Promise<void> {
    try {
      const deptIds = await this.resolveDepartmentIds(args);
      const groupIds: Array<{ groupId: string; via: 'department' | 'closed' }> = [];

      for (const departmentId of deptIds) {
        const g = await this.ensureGroup({
          tenantId: args.tenantId, kind: 'department', refId: departmentId, isClosed: false,
        });
        if (g) groupIds.push({ groupId: g, via: 'department' });
      }

      const closed = await this.resolveClosedKind(args);
      if (closed) {
        const closedGroupId = await this.resolveClosedGroupId(args, closed);
        if (closedGroupId) groupIds.push({ groupId: closedGroupId, via: 'closed' });
      }

      if (groupIds.length === 0) return; // открыт всем (дефолт памяти)

      await this.prisma.ideaBlockAccess.createMany({
        data: groupIds.map((g) => ({ blockId: args.blockId, groupId: g.groupId, via: g.via })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        { blockId: args.blockId, err: err instanceof Error ? err.message : String(err) },
        'block-access-deriver: деривация групп блока не удалась — пропуск (best-effort)',
      );
    }
  }

  /**
   * Ф3 backfill — ТОЛЬКО department-путь (closed задним числом НЕ назначаем).
   * Используется `backfill-block-access.ts` для исторических блоков по флагу
   * `--departments`. Идемпотентно (createMany skipDuplicates). best-effort.
   */
  async deriveDepartmentsOnly(args: {
    tenantId: string;
    blockId: string;
    payload: unknown;
  }): Promise<void> {
    try {
      const deptIds = await this.resolveDepartmentIds({
        tenantId: args.tenantId,
        blockId: args.blockId,
        sourceType: 'meeting',
        payload: args.payload,
      });
      if (deptIds.length === 0) return;

      const data: Array<{ blockId: string; groupId: string; via: 'department' }> = [];
      for (const departmentId of deptIds) {
        const g = await this.ensureGroup({
          tenantId: args.tenantId, kind: 'department', refId: departmentId, isClosed: false,
        });
        if (g) data.push({ blockId: args.blockId, groupId: g, via: 'department' });
      }
      if (data.length === 0) return;

      await this.prisma.ideaBlockAccess.createMany({ data, skipDuplicates: true });
    } catch (err) {
      this.logger.warn(
        { blockId: args.blockId, err: err instanceof Error ? err.message : String(err) },
        'block-access-deriver: deriveDepartmentsOnly не удался — пропуск (best-effort)',
      );
    }
  }

  /** department-id-ы из functional-меток + участников + автора. */
  private async resolveDepartmentIds(args: {
    tenantId: string; blockId: string; sourceType: string; payload: unknown;
  }): Promise<string[]> {
    const deptIds = new Set<string>();

    // (а) functional-метки → FunctionalDomain(slug) → DepartmentDomainLink → Department.
    const funcLabels = await this.prisma.ideaBlockAxisLabel.findMany({
      where: { blockId: args.blockId, axis: 'functional' },
      select: { label: true },
    });
    const slugs = funcLabels.map((l) => l.label).filter(Boolean);
    if (slugs.length > 0) {
      const domains = await this.prisma.functionalDomain.findMany({
        where: { tenantId: args.tenantId, slug: { in: slugs }, deletedAt: null },
        select: { id: true },
      });
      if (domains.length > 0) {
        const links = await this.prisma.departmentDomainLink.findMany({
          where: { tenantId: args.tenantId, domainId: { in: domains.map((d) => d.id) } },
          select: { departmentId: true },
        });
        for (const l of links) deptIds.add(l.departmentId);
      }
    }

    // (б) участники встречи: payload.participants[].userId → Person.primaryDepartmentId.
    const participantUserIds = this.tryGetParticipantUserIds(args.payload);
    if (participantUserIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId: args.tenantId, userId: { in: participantUserIds }, deletedAt: null,
                 primaryDepartmentId: { not: null } },
        select: { primaryDepartmentId: true },
      });
      for (const p of persons) if (p.primaryDepartmentId) deptIds.add(p.primaryDepartmentId);
    }

    // (в) автор блока (subject-entity, записан Ф1) → Person.primaryDepartmentId.
    const subjectDept = await this.resolveSubjectDepartment(args.tenantId, args.blockId);
    if (subjectDept) deptIds.add(subjectDept);

    return [...deptIds];
  }

  private async resolveSubjectDepartment(tenantId: string, blockId: string): Promise<string | null> {
    const subj = await this.prisma.ideaBlockEntity.findFirst({
      where: { blockId, role: 'subject' },
      select: { entityId: true },
    });
    if (!subj) return null;
    const person = await this.prisma.person.findFirst({
      where: { tenantId, entityId: subj.entityId, deletedAt: null, primaryDepartmentId: { not: null } },
      select: { primaryDepartmentId: true },
    });
    return person?.primaryDepartmentId ?? null;
  }

  /** closedGroupKind встречи (payload) или дефолт по типу встречи. Только для meeting. */
  private async resolveClosedKind(args: {
    tenantId: string; sourceType: string; payload: unknown;
  }): Promise<ClosedKind | null> {
    if (args.sourceType !== 'meeting') return null;
    const p = args.payload as { closedGroupKind?: unknown; type?: unknown } | null;
    const manual = typeof p?.closedGroupKind === 'string' ? p.closedGroupKind : null;
    if (manual && this.isClosedKind(manual)) return manual;
    // Дефолт по типу встречи (admin-editable MeetingTypeConfig).
    const type = typeof p?.type === 'string' ? p.type : null;
    if (type) {
      const cfg = await this.prisma.meetingTypeConfig.findUnique({
        where: { id: type }, select: { defaultClosedGroupKind: true },
      });
      const def = cfg?.defaultClosedGroupKind;
      if (def && this.isClosedKind(def)) return def;
    }
    return null;
  }

  private isClosedKind(v: string): v is ClosedKind {
    return v === 'leadership' || v === 'council' || v === 'personal';
  }

  /** id closed-группы. leadership/council → синглтон; personal → группа субъекта. */
  private async resolveClosedGroupId(
    args: { tenantId: string; blockId: string },
    kind: ClosedKind,
  ): Promise<string | null> {
    if (kind === 'leadership' || kind === 'council') {
      return this.ensureGroup({ tenantId: args.tenantId, kind, refId: null, isClosed: true });
    }
    // personal — субъект блока (employee Person).
    const subjectPersonId = await this.resolveSubjectPersonId(args.tenantId, args.blockId);
    if (!subjectPersonId) {
      // Не смогли определить субъекта → safe fallback на leadership (НЕ открыто).
      this.logger.warn(
        { blockId: args.blockId },
        'block-access-deriver: personal без разрешимого субъекта — fallback на leadership',
      );
      return this.ensureGroup({ tenantId: args.tenantId, kind: 'leadership', refId: null, isClosed: true });
    }
    const groupId = await this.ensureGroup({
      tenantId: args.tenantId, kind: 'personal', refId: subjectPersonId, isClosed: true,
      name: 'Личное',
    });
    if (groupId) await this.ensurePersonalMembers(args.tenantId, groupId, subjectPersonId);
    return groupId;
  }

  private async resolveSubjectPersonId(tenantId: string, blockId: string): Promise<string | null> {
    const subj = await this.prisma.ideaBlockEntity.findFirst({
      where: { blockId, role: 'subject' }, select: { entityId: true },
    });
    if (!subj) return null;
    const person = await this.prisma.person.findFirst({
      where: { tenantId, entityId: subj.entityId, deletedAt: null },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  /** Личный сейф = субъект + HR-partner'ы + owner'ы (materialized, идемпотентно). */
  private async ensurePersonalMembers(tenantId: string, groupId: string, subjectPersonId: string): Promise<void> {
    const personIds = new Set<string>([subjectPersonId]);
    // owner/admin (для видимости в UI; доступ им и так bypass) — пропускаем, bypass.
    // hr_partner: Membership.role='hr_partner' с personId.
    const hr = await this.prisma.membership.findMany({
      where: { orgId: tenantId, role: 'hr_partner' as MembershipRole, personId: { not: null } },
      select: { personId: true },
    });
    for (const m of hr) if (m.personId) personIds.add(m.personId);
    await this.prisma.knowledgeGroupMember.createMany({
      data: [...personIds].map((personId) => ({ groupId, personId, source: 'auto' })),
      skipDuplicates: true,
    });
  }

  /** findFirst-or-create группы (идемпотентно, catch P2002). */
  private async ensureGroup(args: {
    tenantId: string; kind: 'department' | 'leadership' | 'council' | 'personal';
    refId: string | null; isClosed: boolean; name?: string;
  }): Promise<string | null> {
    const existing = await this.prisma.knowledgeGroup.findFirst({
      where: { tenantId: args.tenantId, kind: args.kind, refId: args.refId },
      select: { id: true },
    });
    if (existing) return existing.id;
    // Имя: для department — из Department.name; для синглтонов — дефолт.
    let name = args.name ?? null;
    if (!name) {
      if (args.kind === 'department' && args.refId) {
        const dep = await this.prisma.department.findUnique({ where: { id: args.refId }, select: { name: true } });
        name = dep?.name ?? 'Отдел';
      } else if (args.kind === 'leadership') name = 'Руководство';
      else if (args.kind === 'council') name = 'Совет';
      else name = 'Группа';
    }
    try {
      const g = await this.prisma.knowledgeGroup.create({
        data: { tenantId: args.tenantId, kind: args.kind, refId: args.refId, name, isClosed: args.isClosed },
        select: { id: true },
      });
      return g.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const row = await this.prisma.knowledgeGroup.findFirst({
          where: { tenantId: args.tenantId, kind: args.kind, refId: args.refId }, select: { id: true },
        });
        return row?.id ?? null;
      }
      throw err;
    }
  }

  private tryGetParticipantUserIds(payload: unknown): string[] {
    if (typeof payload !== 'object' || payload === null) return [];
    const parts = (payload as { participants?: unknown }).participants;
    if (!Array.isArray(parts)) return [];
    const ids: string[] = [];
    for (const p of parts) {
      const uid = (p as { userId?: unknown })?.userId;
      if (typeof uid === 'string' && uid.trim().length > 0) ids.push(uid);
    }
    return ids;
  }
}
