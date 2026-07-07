import { createPrismaClient } from './_lib/prisma';

const ORG = 'cmr1qbvpx0001pwbwxbgmh1jl';
const Z_GRAPH = 'z_graph';

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const entities = await prisma.entity.count({ where: { tenantId: ORG, mergedIntoId: null } });
  const links = await prisma.entityLink.count({ where: { tenantId: ORG, deletedAt: null } });
  const blockLinks = await prisma.ideaBlockLink.count({ where: { tenantId: ORG, status: 'active' } });
  const blocks = await prisma.ideaBlock.count({ where: { tenantId: ORG, status: 'canonical', mergedIntoId: null } });
  console.log(`РЕЛЯЦИОННЫЙ граф «Стрела»:`);
  console.log(`  Entity(active)=${entities} · EntityLink(active)=${links} · IdeaBlockLink(active)=${blockLinks} · IdeaBlock(canon)=${blocks}`);
  console.log(`  плотность: EntityLink/Entity=${(links / Math.max(1, entities)).toFixed(2)} · BlockLink/Block=${(blockLinks / Math.max(1, blocks)).toFixed(2)}`);

  const linkTypes = await prisma.entityLink.groupBy({
    by: ['relationType'],
    where: { tenantId: ORG, deletedAt: null },
    _count: true,
  });
  console.log(`\n  EntityLink по типам:`);
  for (const t of linkTypes.sort((a, b) => b._count - a._count)) console.log(`    ${t.relationType}: ${t._count}`);

  async function ageCount(label: string, cypher: string): Promise<void> {
    try {
      const sql = `SELECT * FROM cypher('${Z_GRAPH}', $$ ${cypher} $$) AS (v agtype)`;
      const rows = (await prisma.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>;
      console.log(`  ${label}: ${JSON.stringify(rows.map((r) => r.v)).slice(0, 300)}`);
    } catch (e) {
      console.log(`  ${label}: ОШИБКА ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
    }
  }
  console.log(`\nAGE-граф (${Z_GRAPH}):`);
  await ageCount('всего узлов', `MATCH (n) WHERE n.tenant_id = '${ORG}' RETURN count(n)`);
  await ageCount('всего рёбер', `MATCH ()-[r]->() RETURN count(r)`);

  for (const name of ['Ромашка', 'Telegram', 'Александр', 'Логистик', 'Zoom', 'Игорь']) {
    const ents = await prisma.entity.findMany({
      where: { tenantId: ORG, mergedIntoId: null, canonicalName: { contains: name, mode: 'insensitive' } },
      select: { id: true, canonicalName: true, type: true },
      take: 3,
    });
    for (const e of ents) {
      const out = await prisma.entityLink.findMany({
        where: { tenantId: ORG, deletedAt: null, fromEntityId: e.id },
        select: { relationType: true, toEntityId: true },
      });
      const inc = await prisma.entityLink.findMany({
        where: { tenantId: ORG, deletedAt: null, toEntityId: e.id },
        select: { relationType: true, fromEntityId: true },
      });
      const toNames = await prisma.entity.findMany({
        where: { id: { in: [...out.map((x) => x.toEntityId), ...inc.map((x) => x.fromEntityId)] } },
        select: { id: true, canonicalName: true },
      });
      const nm = new Map(toNames.map((x) => [x.id, x.canonicalName]));
      console.log(`\n  «${e.canonicalName}» [${e.type}] out=${out.length} in=${inc.length}`);
      for (const l of out.slice(0, 8)) console.log(`    → ${l.relationType} → ${nm.get(l.toEntityId) ?? l.toEntityId}`);
      for (const l of inc.slice(0, 8)) console.log(`    ← ${l.relationType} ← ${nm.get(l.fromEntityId) ?? l.fromEntityId}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('DIAG ERROR:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
