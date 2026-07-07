import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPrismaClient } from '../../_lib/prisma';
import { RECALL_EVAL_ORG } from '../eval-config';

const ORG = RECALL_EVAL_ORG;
const prisma = createPrismaClient();

type Sig = { entity?: string; phrases: string[] };
type Q = {
  id: string;
  expectedKind: 'answerable' | 'honest_empty';
  expectedEntities: string[];
  expectedBlockSignatures: Sig[];
};

async function entityResolves(name: string): Promise<number> {
  return prisma.entity.count({
    where: {
      tenantId: ORG,
      mergedIntoId: null,
      OR: [{ canonicalName: { contains: name, mode: 'insensitive' } }, { aliases: { has: name } }],
    },
  });
}

async function phraseHits(phrase: string): Promise<number> {
  return prisma.ideaBlock.count({
    where: {
      tenantId: ORG,
      mergedIntoId: null,
      OR: [
        { name: { contains: phrase, mode: 'insensitive' } },
        { criticalQuestion: { contains: phrase, mode: 'insensitive' } },
        { trustedAnswer: { contains: phrase, mode: 'insensitive' } },
      ],
    },
  });
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(join(__dirname, 'recall-gold.json'), 'utf8')) as { questions: Q[] };
  const answerable = raw.questions.filter((q) => q.expectedKind === 'answerable');
  const empties = raw.questions.filter((q) => q.expectedKind === 'honest_empty');
  console.log(`gold: ${raw.questions.length} total · ${answerable.length} answerable · ${empties.length} honest_empty\n`);

  const unresolvedEntities: string[] = [];
  const weakSignatures: string[] = [];

  for (const q of answerable) {
    for (const name of q.expectedEntities) {
      const n = await entityResolves(name);
      if (n === 0) unresolvedEntities.push(`${q.id}: entity «${name}» → 0`);
    }
    for (let i = 0; i < q.expectedBlockSignatures.length; i++) {
      const sig = q.expectedBlockSignatures[i];
      const perPhrase: Array<[string, number]> = [];
      for (const p of sig.phrases) perPhrase.push([p, await phraseHits(p)]);
      const matchedPhrases = perPhrase.filter(([, c]) => c > 0).length;
      if (matchedPhrases === 0) {
        weakSignatures.push(
          `${q.id}: sig#${i}${sig.entity ? ` (${sig.entity})` : ''} → 0 blocks · ${perPhrase
            .map(([p, c]) => `${p}=${c}`)
            .join(', ')}`,
        );
      }
    }
  }

  console.log('=== UNRESOLVED ENTITIES (0 активных) ===');
  console.log(unresolvedEntities.length ? unresolvedEntities.join('\n') : '  — нет, все резолвятся');
  console.log('\n=== WEAK SIGNATURES (ни одна фраза не нашла блок) ===');
  console.log(weakSignatures.length ? weakSignatures.join('\n') : '  — нет, все сигнатуры резолвятся');
  console.log(
    `\nИТОГ: entities unresolved=${unresolvedEntities.length} · signatures weak=${weakSignatures.length}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('ERR:', e?.message ?? e);
    await prisma.$disconnect();
    process.exit(1);
  });
