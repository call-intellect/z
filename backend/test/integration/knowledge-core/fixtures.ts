/**
 * Тестовые фикстуры для knowledge-core integration specs (Phase F.2).
 *
 * Создаёт изолированные данные с уникальными префиксами per spec-suite,
 * чтобы параллельные/повторные запуски не конфликтовали друг с другом и
 * не задевали prod/dev-данные.
 *
 * Контракт:
 *   - все ID начинаются с префикса (`prefix`), который caller передаёт сам;
 *   - `cleanup()` удаляет ВСЁ, что создал текущий fixture, и НИЧЕГО кроме.
 *
 * Не использовать `deleteMany({})` без фильтра — это снесёт чужие данные.
 */

import type { PrismaClient } from '@prisma/client';

export interface KnowledgeCoreFixture {
  prefix: string;
  orgAId: string;
  orgBId: string;
  userOwnerAId: string;
  userOwnerBId: string;
  blockAId: string;
  themeAId: string;
  entityAId: string;
  rawEventAId: string;
  sourceAId: string;
  /** Снести всё, что создано этой фикстурой. */
  cleanup: () => Promise<void>;
}

export async function buildKnowledgeCoreFixture(
  prisma: PrismaClient,
  prefix: string,
): Promise<KnowledgeCoreFixture> {
  const orgAId = `${prefix}-orgA`;
  const orgBId = `${prefix}-orgB`;
  const userOwnerAId = `${prefix}-userA`;
  const userOwnerBId = `${prefix}-userB`;
  const blockAId = `${prefix}-blockA`;
  const themeAId = `${prefix}-themeA`;
  const entityAId = `${prefix}-entityA`;
  const rawEventAId = `${prefix}-rawA`;
  const sourceAId = `${prefix}-srcA`;

  // Чистим возможные остатки с прошлого запуска до создания (иначе P2002).
  await cleanupByPrefix(prisma, prefix);

  await prisma.$transaction(async (tx) => {
    // Создаём users перед orgs — Org.ownerId требует существующего User.
    await tx.user.create({
      data: {
        id: userOwnerAId,
        email: `${prefix}-ownera@test.local`,
        name: `Owner A ${prefix}`,
      },
    });
    await tx.user.create({
      data: {
        id: userOwnerBId,
        email: `${prefix}-ownerb@test.local`,
        name: `Owner B ${prefix}`,
      },
    });
    await tx.org.create({
      data: {
        id: orgAId,
        name: `${prefix} OrgA`,
        slug: `${prefix}-orga`,
        ownerId: userOwnerAId,
        visibilityMode: 'open',
      },
    });
    await tx.org.create({
      data: {
        id: orgBId,
        name: `${prefix} OrgB`,
        slug: `${prefix}-orgb`,
        ownerId: userOwnerBId,
        visibilityMode: 'open',
      },
    });
    await tx.membership.create({
      data: { orgId: orgAId, userId: userOwnerAId, role: 'owner' },
    });
    await tx.membership.create({
      data: { orgId: orgBId, userId: userOwnerBId, role: 'owner' },
    });

    // Минимальный набор данных knowledge-core для OrgA.
    await tx.source.create({
      data: {
        id: sourceAId,
        tenantId: orgAId,
        type: 'meeting',
        name: `${prefix} source`,
        dataClass: 'internal',
      },
    });
    await tx.rawEvent.create({
      data: {
        id: rawEventAId,
        tenantId: orgAId,
        sourceId: sourceAId,
        sourceType: 'meeting',
        sourceExternalId: `${prefix}-ext`,
        idempotencyKey: `${prefix}-idem-raw`,
        occurredAt: new Date('2026-05-01T10:00:00Z'),
        payload: { fixture: prefix },
        payloadChecksum: `${prefix}-checksum`,
        payloadSizeBytes: 16,
        dataClass: 'internal',
      },
    });
    await tx.ideaBlock.create({
      data: {
        id: blockAId,
        tenantId: orgAId,
        name: `Тестовый блок ${prefix}`,
        criticalQuestion: 'Как тестировать knowledge-core?',
        trustedAnswer: 'Через integration-тесты на реальном Postgres.',
        signalType: 'fact',
        tags: ['integration', prefix],
        status: 'canonical',
        evidenceCount: 1,
      },
    });
    await tx.ideaBlockEvidence.create({
      data: {
        tenantId: orgAId,
        blockId: blockAId,
        rawEventId: rawEventAId,
        sourceType: 'meeting',
        quote: 'Тестовая цитата для integration-spec',
      },
    });
    await tx.entity.create({
      data: {
        id: entityAId,
        tenantId: orgAId,
        type: 'topic',
        canonicalName: `Тестовая сущность ${prefix}`,
        aliases: ['fixture'],
        mentionsCount: 1,
      },
    });
    await tx.ideaBlockEntity.create({
      data: {
        tenantId: orgAId,
        blockId: blockAId,
        entityId: entityAId,
        mentionContext: `${prefix} mention context`,
      },
    });
    await tx.theme.create({
      data: {
        id: themeAId,
        tenantId: orgAId,
        name: `Тестовая тема ${prefix}`,
        description: 'integration fixture',
        status: 'active',
      },
    });
    await tx.themeIdeaBlock.create({
      data: { tenantId: orgAId, themeId: themeAId, blockId: blockAId },
    });
    await tx.themeEntity.create({
      data: { tenantId: orgAId, themeId: themeAId, entityId: entityAId },
    });
  });

  return {
    prefix,
    orgAId,
    orgBId,
    userOwnerAId,
    userOwnerBId,
    blockAId,
    themeAId,
    entityAId,
    rawEventAId,
    sourceAId,
    cleanup: () => cleanupByPrefix(prisma, prefix),
  };
}

/**
 * Удалить всё, что было создано фикстурой с данным префиксом.
 * Порядок важен — сначала dependent, потом parent.
 */
export async function cleanupByPrefix(
  prisma: PrismaClient,
  prefix: string,
): Promise<void> {
  await prisma.themeEntity
    .deleteMany({ where: { themeId: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.themeIdeaBlock
    .deleteMany({ where: { themeId: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.theme
    .deleteMany({ where: { id: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.ideaBlockEntity
    .deleteMany({ where: { blockId: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.ideaBlockEvidence
    .deleteMany({ where: { blockId: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.entity
    .deleteMany({ where: { id: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.ideaBlock
    .deleteMany({ where: { id: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.rawEvent
    .deleteMany({ where: { id: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.source
    .deleteMany({ where: { id: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.membership
    .deleteMany({ where: { userId: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { id: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
  await prisma.org
    .deleteMany({ where: { id: { startsWith: `${prefix}-` } } })
    .catch(() => undefined);
}
