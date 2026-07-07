import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';

@Injectable()
export class ThemeWriteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
  ) {}

  async createTheme(args: {
    tenantId: string;
    phrase: string;
    visibility: 'personal' | 'team';
    createdByUserId: string;
  }): Promise<{ id: string }> {
    const { tenantId, phrase, visibility, createdByUserId } = args;
    const description = phrase.trim();
    const name = description.slice(0, 200);

    const created = await this.prisma.theme.create({
      data: {
        tenantId,
        name,
        description,
        origin: 'user',
        createdByUserId,
        visibility,
        status: 'active',
        lastSignalAt: new Date(),
      },
      select: { id: true },
    });

    const embedding = await this.embeddings.embedQuery(phrase);
    if (embedding && embedding.length > 0) {
      await this.prisma.$executeRawUnsafe(
        'UPDATE "Theme" SET embedding = $1::vector(1536) WHERE id = $2',
        toVectorLiteral(embedding),
        created.id,
      );
    }

    return { id: created.id };
  }

  async renameTheme(args: {
    tenantId: string;
    themeId: string;
    name: string;
  }): Promise<void> {
    await this.prisma.theme.update({
      where: { id: args.themeId, tenantId: args.tenantId },
      data: { name: args.name },
    });
  }

  async archiveTheme(args: { tenantId: string; themeId: string }): Promise<void> {
    await this.prisma.theme.update({
      where: { id: args.themeId, tenantId: args.tenantId },
      data: { status: 'archived' },
    });
  }

  async pin(args: {
    tenantId: string;
    themeId: string;
    kind: 'block' | 'entity';
    objectId: string;
  }): Promise<void> {
    const { tenantId, themeId, kind, objectId } = args;

    await this.prisma.themeExclusion.deleteMany({
      where: {
        tenantId,
        themeId,
        kind,
        blockId: kind === 'block' ? objectId : null,
        entityId: kind === 'entity' ? objectId : null,
      },
    });

    if (kind === 'block') {
      await this.prisma.themeIdeaBlock.upsert({
        where: {
          themeId_blockId_tenantId: { themeId, blockId: objectId, tenantId },
        },
        create: { tenantId, themeId, blockId: objectId, addedVia: 'manual' },
        update: {},
      });
    } else {
      await this.prisma.themeEntity.upsert({
        where: {
          themeId_entityId_tenantId: { themeId, entityId: objectId, tenantId },
        },
        create: { tenantId, themeId, entityId: objectId },
        update: {},
      });
    }
  }

  async unpin(args: {
    tenantId: string;
    themeId: string;
    kind: 'block' | 'entity';
    objectId: string;
    createdByUserId: string;
  }): Promise<void> {
    const { tenantId, themeId, kind, objectId, createdByUserId } = args;

    if (kind === 'block') {
      await this.prisma.themeIdeaBlock.deleteMany({
        where: { themeId, blockId: objectId, tenantId },
      });
    } else {
      await this.prisma.themeEntity.deleteMany({
        where: { themeId, entityId: objectId, tenantId },
      });
    }

    const blockId = kind === 'block' ? objectId : null;
    const entityId = kind === 'entity' ? objectId : null;

    const existing = await this.prisma.themeExclusion.findFirst({
      where: { themeId, kind, blockId, entityId },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.themeExclusion.create({
        data: { tenantId, themeId, kind, blockId, entityId, createdByUserId },
      });
    }
  }
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
