import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RoleContextForPrompt } from '../../knowledge-core/prompts/role-profile-build.prompt';

/**
 * ContextBuilder для RoleProfileAgent (Фаза 0d).
 *
 * Собирает контекст «всё, что касается роли» в форме `RoleContextForPrompt`,
 * который потом скармливается LLM через `buildRoleProfilePrompt`.
 *
 * **Идеальная имплементация** — обход графа через `GraphService.traverse` с
 * Cypher по AGE (см. plans/tz/2026-05-21-phase-0d-role-profile-agent.md §5.1).
 * Пока GraphService разрабатывается параллельно (Фаза 0a.2), используем
 * упрощённый прямой Prisma-обход. Когда GraphService станет доступен — этот
 * сервис переписывается на `graphService.traverse(...)` без изменения публичного
 * API.
 *
 * Лимиты контекста (из ТЗ §5.3):
 *   - IdeaBlocks: top-50 по дате (новые ценнее observed-картины).
 *   - Themes: top-10 по релевантности (упрощённо — последние участвовавшие).
 *   - Decisions: top-20 свежих.
 *   - Persons: все активные на этой роли.
 *   - Processes: только те, где Role — ownerRoleId.
 */
@Injectable()
export class RoleProfileContextBuilder {
  private readonly logger = new Logger(RoleProfileContextBuilder.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async buildContext(params: {
    tenantId: string;
    roleId: string;
    maxBlocks?: number;
    maxDecisions?: number;
    maxThemes?: number;
  }): Promise<RoleContextForPrompt> {
    const { tenantId, roleId } = params;
    const maxBlocks = params.maxBlocks ?? 50;
    const maxDecisions = params.maxDecisions ?? 20;
    const maxThemes = params.maxThemes ?? 10;

    // 1) Сама Role + Department.
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { department: true },
    });
    if (role.tenantId !== tenantId) {
      throw new Error('role tenant mismatch');
    }

    // 2) Последняя JobDescription (declared).
    const jobDescription = await this.prisma.jobDescription.findFirst({
      where: { tenantId, roleId, deletedAt: null },
      orderBy: { version: 'desc' },
    });

    // 3) Persons активно на роли (PersonRole.validTo IS NULL).
    const personRoles = await this.prisma.personRole.findMany({
      where: { tenantId, roleId, validTo: null },
      include: { person: true },
    });
    const persons = personRoles
      .filter((pr) => pr.person.deletedAt === null)
      .map((pr) => ({ id: pr.person.id, name: pr.person.name }));

    // 4) IdeaBlock-и с role_relevant=true для этой роли.
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        roleRelevant: true,
        roleId,
        status: { in: ['canonical', 'draft'] },
      },
      orderBy: { createdAt: 'desc' },
      take: maxBlocks,
      include: {
        evidence: {
          take: 1,
          include: {
            rawEvent: { select: { sourceType: true, sourceId: true } },
          },
        },
      },
    });

    // Подтягиваем имена источников (Meeting.title / Document.name).
    const meetingIdsFromEvidence: string[] = [];
    const documentIdsFromEvidence: string[] = [];
    for (const b of blocks) {
      const ev = b.evidence[0];
      if (!ev) continue;
      if (ev.sourceType === 'meeting') meetingIdsFromEvidence.push(ev.rawEvent.sourceId);
      // У документов нет прямого source; в Фазе 0b document.adapter положит
      // Document.id в RawEvent.sourceExternalId. Здесь — best effort.
    }
    const meetings = meetingIdsFromEvidence.length
      ? await this.prisma.meeting.findMany({
          where: { id: { in: meetingIdsFromEvidence } },
          select: { id: true, title: true },
        })
      : [];
    const meetingTitleById = new Map(meetings.map((m) => [m.id, m.title]));

    const ideaBlocksForPrompt = blocks.map((b) => {
      const ev = b.evidence[0];
      const meetingTitle =
        ev?.sourceType === 'meeting'
          ? meetingTitleById.get(ev.rawEvent.sourceId)
          : undefined;
      return {
        id: b.id,
        text: b.trustedAnswer.slice(0, 400),
        signalType: b.signalType,
        sourceMeetingTitle: meetingTitle ?? undefined,
        sourceDocumentName: undefined as string | undefined,
        createdAt: b.createdAt.toISOString(),
      };
    });

    // 5) Темы, к которым относятся блоки выше.
    const themeIds = blocks.length
      ? (
          await this.prisma.themeIdeaBlock.findMany({
            where: {
              blockId: { in: blocks.map((b) => b.id) },
            },
            select: { themeId: true },
            distinct: ['themeId'],
          })
        ).map((t) => t.themeId)
      : [];
    const themesRaw = themeIds.length
      ? await this.prisma.theme.findMany({
          where: { id: { in: themeIds }, status: 'active' },
          take: maxThemes,
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const themes = themesRaw.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description.slice(0, 200),
    }));

    // 6) Процессы, owner = эта роль.
    const processesRaw = await this.prisma.process.findMany({
      where: { tenantId, ownerRoleId: roleId, status: 'active' },
      take: 10,
    });
    const processes = processesRaw.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));

    // 7) Decisions, связанные с участниками роли. Через decidedByPersonId.
    const personIds = persons.map((p) => p.id);
    const decisionsRaw = personIds.length
      ? await this.prisma.decision.findMany({
          where: {
            tenantId,
            decidedByPersonId: { in: personIds },
            status: 'active',
          },
          orderBy: { decidedAt: 'desc' },
          take: maxDecisions,
        })
      : [];
    // SBA β-3 — Decision.text и Decision.decidedAt теперь nullable
    // (статус 0a → β-3 расширение). Используем fallback на statement / createdAt.
    const decisions = decisionsRaw.map((d) => ({
      id: d.id,
      text: (d.text ?? d.statement ?? '').slice(0, 400),
      rationale: d.rationale ?? null,
      decidedAt: (d.decidedAt ?? d.createdAt).toISOString(),
    }));

    return {
      role: {
        id: role.id,
        name: role.name,
        departmentName: role.department?.name ?? null,
      },
      jobDescriptionMd: jobDescription?.contentMd ?? null,
      persons,
      ideaBlocks: ideaBlocksForPrompt,
      themes,
      processes,
      decisions,
    };
  }
}
