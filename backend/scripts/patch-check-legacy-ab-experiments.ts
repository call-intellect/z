import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface LegacyExperimentJson {
  enabled?: boolean;
  endsAt?: string;
}

async function main(): Promise<void> {
  console.log('=== patch-check-legacy-ab-experiments START (read-only) ===');
  const routes = await prisma.llmTaskRoute.findMany({
    where: { tenantId: null, experiment: { not: null } },
    select: { taskType: true, experiment: true },
  });
  const now = Date.now();
  const active: string[] = [];
  for (const r of routes) {
    const exp = r.experiment as LegacyExperimentJson | null;
    if (!exp) continue;
    const endsAt = exp.endsAt ? Date.parse(exp.endsAt) : Number.NaN;
    if (exp.enabled === true && Number.isFinite(endsAt) && endsAt > now) {
      active.push(r.taskType);
    }
  }
  if (active.length > 0) {
    console.warn(
      `ВНИМАНИЕ: найдены активные легаси A/B-эксперименты (route.experiment), которые больше не сплитуют трафик после Фазы 1-2 этой миграции: ${active.join(', ')}. Пересоздайте их вручную через новый UI/API LlmModelExperiment.`,
    );
  } else {
    console.log('Активных легаси-экспериментов не найдено.');
  }
  console.log('=== patch-check-legacy-ab-experiments DONE (read-only, ничего не изменено) ===');
}

main()
  .catch((err) => {
    console.error('patch-check-legacy-ab-experiments FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
