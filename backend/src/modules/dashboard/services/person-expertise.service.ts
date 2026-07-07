import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface ExpertiseTopicDto {
  id: string;
  name: string;
  count: number;
  kind: string | null;
}

export interface MyExpertiseDto {
  blocksScanned: number;
  themes: ExpertiseTopicDto[];
  entities: ExpertiseTopicDto[];
}

@Injectable()
export class PersonExpertiseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getMyExpertise(args: { tenantId: string; personId: string }): Promise<MyExpertiseDto> {
    const { tenantId, personId } = args;
    const maxBlocks = await this.cfg.getDynamic<number>(
      'knowledge.expertise.self_max_blocks_scanned',
      undefined,
      2000,
    );
    const topK = await this.cfg.getDynamic<number>('knowledge.expertise.self_top_k', undefined, 10);

    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { tenantId, authorPersonId: personId },
      orderBy: { sourceTimestamp: 'desc' },
      take: maxBlocks,
      select: { blockId: true },
    });
    const blockIds = [...new Set(evidence.map((e) => e.blockId))];
    if (blockIds.length === 0) return { blocksScanned: 0, themes: [], entities: [] };

    const [themeGroups, entityGroups] = await Promise.all([
      this.prisma.themeIdeaBlock.groupBy({
        by: ['themeId'],
        where: { tenantId, blockId: { in: blockIds } },
        _count: { _all: true },
      }),
      this.prisma.ideaBlockEntity.groupBy({
        by: ['entityId'],
        where: { tenantId, blockId: { in: blockIds } },
        _count: { _all: true },
      }),
    ]);

    const topThemes = [...themeGroups]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, topK);
    const topEntities = [...entityGroups]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, topK);

    const [themes, entities] = await Promise.all([
      topThemes.length > 0
        ? this.prisma.theme.findMany({
            where: { tenantId, id: { in: topThemes.map((t) => t.themeId) } },
            select: { id: true, name: true, status: true },
          })
        : Promise.resolve([]),
      topEntities.length > 0
        ? this.prisma.entity.findMany({
            where: { tenantId, id: { in: topEntities.map((e) => e.entityId) } },
            select: { id: true, canonicalName: true, type: true },
          })
        : Promise.resolve([]),
    ]);
    const themeById = new Map(themes.map((t) => [t.id, t]));
    const entityById = new Map(entities.map((e) => [e.id, e]));

    return {
      blocksScanned: blockIds.length,
      themes: topThemes.map((g) => {
        const t = themeById.get(g.themeId);
        return { id: g.themeId, name: t?.name ?? '—', count: g._count._all, kind: t?.status ?? null };
      }),
      entities: topEntities.map((g) => {
        const e = entityById.get(g.entityId);
        return {
          id: g.entityId,
          name: e?.canonicalName ?? '—',
          count: g._count._all,
          kind: e?.type ?? null,
        };
      }),
    };
  }
}
