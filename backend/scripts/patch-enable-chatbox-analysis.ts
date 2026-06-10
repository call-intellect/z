/**
 * Patch: включить анализ для уже подключённых ChatBox-интеграций
 * (ТЗ 2026-06-10 cabinet §5, решение Р-5).
 *
 * Контекст: исторически `ChatboxIntegration.analysisEnabled` по умолчанию был
 * `false` (молчаливый OFF), поэтому переписка зеркалилась синком, но НЕ
 * анализировалась — чаты не попадали в граф/память. Подключение канала = согласие
 * на анализ (как создание встречи / загрузка аудио), поэтому уже подключённые
 * интеграции включаем. Дальше cron `analyze-sweep` сам подберёт их `pending` +
 * закрытые (`endedAt != null`) сессии и поставит в очередь анализа — отдельный
 * бэкофилл сессий не нужен.
 *
 * Идемпотентно: повторный прогон → 0 (нет интеграций с analysisEnabled=false).
 * Дефолт dry-run; запись — флагом `--apply`.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-enable-chatbox-analysis.ts            # dry-run
 *   docker compose exec backend bun run scripts/patch-enable-chatbox-analysis.ts --apply     # запись
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'patch', skipBootstrap).
 */

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

export interface Stats {
  scanned: number;
  updated: number;
}

export async function patchEnableChatboxAnalysis(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<Stats> {
  const targets = await prisma.chatboxIntegration.findMany({
    where: { analysisEnabled: false },
    select: { tenantId: true, workspaceName: true },
  });

  console.log(
    `patch-enable-chatbox-analysis: ${targets.length} интеграций с analysisEnabled=false`,
  );
  for (const t of targets) {
    console.log(`  - tenant=${t.tenantId} workspace=${t.workspaceName ?? '—'}`);
  }

  if (!opts.apply) {
    console.log(`[DRY-RUN] would enable ${targets.length} (запусти с --apply)`);
    return { scanned: targets.length, updated: 0 };
  }

  const res = await prisma.chatboxIntegration.updateMany({
    where: { analysisEnabled: false },
    data: { analysisEnabled: true },
  });
  console.log(`APPLIED: analysisEnabled=true для ${res.count} интеграций`);
  console.log('cron analyze-sweep подберёт их pending/закрытые сессии автоматически.');
  return { scanned: targets.length, updated: res.count };
}

// CLI-враппер.
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  patchEnableChatboxAnalysis(prisma, { apply })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('patch-enable-chatbox-analysis FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
