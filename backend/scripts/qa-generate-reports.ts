import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ThemeClustererCron } from '../src/modules/knowledge-core/workers/theme-clusterer.cron';
import { ThemeSummarizeCron } from '../src/modules/knowledge-core/workers/theme-summarize.cron';
import { GoalThemeLinkerCron } from '../src/modules/knowledge-core/workers/goal-theme-linker.cron';
import { KnowledgeCloneRebuildCron } from '../src/modules/knowledge-core/workers/knowledge-clone-rebuild.cron';
import { GoalHierarchyRebuildCron } from '../src/modules/knowledge-core/workers/goal-hierarchy-rebuild.cron';
import { StrategicAlignmentCron } from '../src/modules/goals/cron/strategic-alignment.cron';
import { DailyDigestService } from '../src/modules/operations/services/daily-digest.service';
import { WeeklyDigestService } from '../src/modules/operations/services/weekly-digest.service';
import { MonthlyDigestService } from '../src/modules/operations/services/monthly-digest.service';

function log(m: string): void {
  // eslint-disable-next-line no-console
  console.log(m);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    log(`  ✓ ${label} (${((Date.now() - t0) / 1000).toFixed(0)}s) ${r ? JSON.stringify(r).slice(0, 160) : ''}`);
  } catch (e) {
    log(`  ✗ ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  const tenantId = process.env['STRELA_ORG'];
  if (!tenantId) throw new Error('STRELA_ORG не задан');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  log(`=== qa-generate-reports: tenant=${tenantId} ===`);

  const themeClusterer = app.get(ThemeClustererCron);
  const themeSummarize = app.get(ThemeSummarizeCron);
  const goalThemeLinker = app.get(GoalThemeLinkerCron);
  const cloneRebuild = app.get(KnowledgeCloneRebuildCron);
  const hierarchyRebuild = app.get(GoalHierarchyRebuildCron);
  const strategicAlignment = app.get(StrategicAlignmentCron);
  const daily = app.get(DailyDigestService);
  const weekly = app.get(WeeklyDigestService);
  const monthly = app.get(MonthlyDigestService);

  log('— Граф-производные (темы/цели/клоны):');
  await step('theme-clusterer', () => themeClusterer.runForAllOrgs());
  await step('theme-summarize', () => themeSummarize.processOrg(tenantId));
  await step('goal-theme-linker', () => goalThemeLinker.scanAllOrgs());
  await step('goal-hierarchy-rebuild', () => hierarchyRebuild.runOnce());
  await step('strategic-alignment', () => strategicAlignment.runForAllOrgs());
  await step('knowledge-clone-rebuild', () => cloneRebuild.runOnce());

  if (process.env['QA_WITH_DIGESTS'] !== '1') {
    await app.close();
    log('=== qa-generate-reports DONE (только граф-производные; дайджесты пропущены) ===');
    return;
  }

  log('— Дневные дайджесты (последние 8 дней):');
  const now = new Date();
  for (let d = 0; d <= 8; d++) {
    const day = new Date(now.getTime() - d * 86_400_000);
    await step(`daily ${ymd(day)}`, () => daily.generate({ tenantId, dateLocal: ymd(day) }));
  }

  log('— Недельные дайджесты (эта + прошлая неделя):');
  const monday = (offsetWeeks: number): { s: string; e: string } => {
    const base = new Date(now.getTime() - offsetWeeks * 7 * 86_400_000);
    const dow = (base.getUTCDay() + 6) % 7;
    const s = new Date(base.getTime() - dow * 86_400_000);
    const e = new Date(s.getTime() + 6 * 86_400_000);
    return { s: ymd(s), e: ymd(e) };
  };
  for (const w of [0, 1, 2, 3]) {
    const { s, e } = monday(w);
    await step(`weekly ${s}..${e}`, () => weekly.generate({ tenantId, weekStart: s, weekEnd: e }));
  }

  log('— Месячные дайджесты (2026-06 богатый, 2026-07):');
  for (const ym of ['2026-06', '2026-07']) {
    await step(`monthly ${ym}`, () => monthly.generate({ tenantId, periodYm: ym }));
  }

  await app.close();
  log('=== qa-generate-reports DONE ===');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('qa-generate-reports FATAL:', e);
    process.exit(1);
  });
