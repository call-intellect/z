import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RoleContextForPrompt } from '../../knowledge-core/prompts/role-profile-build.prompt';

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

    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { department: true },
    });
    if (role.tenantId !== tenantId) {
      throw new Error('role tenant mismatch');
    }

    const jobDescription = await this.prisma.jobDescription.findFirst({
      where: { tenantId, roleId, deletedAt: null },
      orderBy: { version: 'desc' },
    });

    const personRoles = await this.prisma.personRole.findMany({
      where: { tenantId, roleId, validTo: null },
      include: { person: true },
    });
    const persons = personRoles
      .filter((pr) => pr.person.deletedAt === null)
      .map((pr) => ({ id: pr.person.id, name: pr.person.name }));

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

    const meetingIdsFromEvidence: string[] = [];
    const _documentIdsFromEvidence: string[] = [];
    for (const b of blocks) {
      const ev = b.evidence[0];
      if (!ev) continue;
      if (ev.sourceType === 'meeting') meetingIdsFromEvidence.push(ev.rawEvent.sourceId);
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
        ev?.sourceType === 'meeting' ? meetingTitleById.get(ev.rawEvent.sourceId) : undefined;
      return {
        id: b.id,
        text: b.trustedAnswer.slice(0, 400),
        signalType: b.signalType,
        sourceMeetingTitle: meetingTitle ?? undefined,
        sourceDocumentName: undefined as string | undefined,
        createdAt: b.createdAt.toISOString(),
      };
    });

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

    const processesRaw = await this.prisma.process.findMany({
      where: { tenantId, ownerRoleId: roleId, status: 'active' },
      take: 10,
    });
    const processes = processesRaw.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));

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
