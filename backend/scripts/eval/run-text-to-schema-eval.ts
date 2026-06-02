/**
 * Eval Text-to-Schema (Smart-tables auto-creation, Фаза 1.5) — РЕАЛЬНЫЙ прогон.
 *
 * БЛОКЕР для включения feature-flag `feature.tables_text_to_schema`: прогоняет
 * 100+ русских NL-запросов из `backend/test/eval/text-to-schema/fixtures/*.json`
 * через ПРОДАКШЕН-путь `TableAgentService.inferSchemaFromText` (3 LLM-pass'а:
 * DRAFT → ARCHITECT → ENTITY-CHECK) и сравнивает с golden-схемами по метрикам
 * из `test/eval/text-to-schema/metrics.ts`.
 *
 * ⚠️ ТРЕБУЕТ LLM-ПРОКСИ (proxy.agent-lia.ru) + поднятый Nest-контекст. В среде
 * разработки прокси НЕТ — здесь скрипт не прогоняется. Метрики и валидность
 * фикстур покрыты OFFLINE unit-тестами:
 *   bunx vitest run test/eval/text-to-schema/metrics.spec.ts
 *
 * Запуск на проде (всё в docker-compose):
 *   docker compose exec backend bun run scripts/eval/run-text-to-schema-eval.ts
 *   # с явным тест-tenant:
 *   docker compose exec -e EVAL_TENANT_ID=<orgId> backend \
 *     bun run scripts/eval/run-text-to-schema-eval.ts
 *
 * Tenant: из аргумента `--tenant <id>` или ENV `EVAL_TENANT_ID`. Если не задан —
 * берём первую не-удалённую Org (для eval годится любой tenant: доступные
 * entitySync-типы сейчас одинаковы для всех — все 4).
 *
 * Пороги PASS (см. ТЗ `plans/tz/2026-06-02-smart-tables-auto-creation.md`, Ф1.5):
 *   schema-F1 ≥ 0.85 И hallucination-rate ≤ 0.05.
 * При FAIL — exit code 1 (чтобы CI/оператор не включил флаг).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  TableAgentService,
  type InferredTableSchema,
} from '../../src/modules/tables/services/table-agent.service';
import {
  aggregate,
  computeCaseMetrics,
  evaluateThresholds,
  THRESHOLDS,
  type AggregateBucket,
  type EvalCaseResult,
  type EvalSchema,
} from '../../test/eval/text-to-schema/metrics';

// SCRIPT_DIR с поправкой на Windows-пути (file:///C:/...).
const SCRIPT_DIR = path
  .dirname(new URL(import.meta.url).pathname)
  .replace(/^\/([A-Za-z]):/, '$1:');
const FIXTURES_DIR = path.resolve(SCRIPT_DIR, '../../test/eval/text-to-schema/fixtures');
const REPORTS_DIR = path.resolve(SCRIPT_DIR, '../../test/eval/text-to-schema/reports');

interface GoldenSchema {
  name: string;
  entitySync: { type: string } | null;
  properties: Array<{ name: string; type: string; isPrimary: boolean }>;
}
interface Fixture {
  id: string;
  category: string;
  specificity: string;
  nlPrompt: string;
  golden: GoldenSchema;
}

/** Приводит InferredTableSchema (продакшен-результат) к EvalSchema для метрик. */
function toEvalSchema(s: InferredTableSchema): EvalSchema {
  return {
    name: s.name,
    entitySync: s.entitySync,
    properties: s.properties.map((p) => ({
      name: p.name,
      type: p.type,
      isPrimary: p.isPrimary,
    })),
  };
}

async function loadFixtures(): Promise<Fixture[]> {
  const files = (await fs.readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out: Fixture[] = [];
  for (const file of files) {
    const arr = JSON.parse(
      await fs.readFile(path.join(FIXTURES_DIR, file), 'utf-8'),
    ) as Fixture[];
    out.push(...arr);
  }
  return out;
}

function parseTenantArg(): string | null {
  const idx = process.argv.indexOf('--tenant');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return process.env.EVAL_TENANT_ID ?? null;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printBucketTable(
  title: string,
  buckets: Record<string, AggregateBucket>,
): void {
  console.log(`\n  ${title}:`);
  console.log(
    `    ${'ключ'.padEnd(12)} ${'n'.padStart(3)} ${'F1'.padStart(7)} ${'prec'.padStart(7)} ${'recall'.padStart(7)} ${'type'.padStart(7)} ${'entity'.padStart(7)} ${'halluc'.padStart(7)}`,
  );
  for (const [key, b] of Object.entries(buckets).sort()) {
    console.log(
      `    ${key.padEnd(12)} ${String(b.count).padStart(3)} ${fmtPct(b.schemaF1).padStart(7)} ${fmtPct(b.precision).padStart(7)} ${fmtPct(b.recall).padStart(7)} ${fmtPct(b.typeCorrectness).padStart(7)} ${fmtPct(b.entityBinding).padStart(7)} ${fmtPct(b.hallucinationRate).padStart(7)}`,
    );
  }
}

async function main(): Promise<void> {
  console.log('=== Eval Text-to-Schema (Фаза 1.5) ===');

  const fixtures = await loadFixtures();
  console.log(`  фикстур: ${fixtures.length}`);
  if (fixtures.length < 100) {
    console.warn(
      `  ⚠ ожидалось ≥100 фикстур, найдено ${fixtures.length} — набор неполный`,
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  // timestamp для имён отчётов (в скрипте Date — допустимо).
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  try {
    const prisma = app.get(PrismaService);
    const agent = app.get(TableAgentService);

    // Тест-tenant: arg/ENV или первая не-удалённая Org.
    let tenantId = parseTenantArg();
    if (!tenantId) {
      const org = await prisma.org.findFirst({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!org) {
        console.error(
          '✗ Не найдено ни одной Org. Передай --tenant <id> или EVAL_TENANT_ID.',
        );
        process.exit(1);
      }
      tenantId = org.id;
      console.log(`  tenant (авто): ${org.name} [${org.id}]`);
    } else {
      console.log(`  tenant: ${tenantId}`);
    }
    console.log('');

    const results: EvalCaseResult[] = [];
    const perCaseDetails: Array<{
      id: string;
      category: string;
      specificity: string;
      nlPrompt: string;
      golden: GoldenSchema;
      predicted: EvalSchema | null;
      error?: string;
      metrics: EvalCaseResult | null;
    }> = [];

    let i = 0;
    for (const fx of fixtures) {
      i += 1;
      let predicted: EvalSchema | null = null;
      let error: string | undefined;
      try {
        const inferred = await agent.inferSchemaFromText({
          tenantId,
          userPrompt: fx.nlPrompt,
        });
        predicted = toEvalSchema(inferred);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      let metrics: EvalCaseResult | null = null;
      if (predicted) {
        metrics = computeCaseMetrics({
          id: fx.id,
          category: fx.category,
          specificity: fx.specificity,
          golden: fx.golden as EvalSchema,
          predicted,
        });
        results.push(metrics);
      } else {
        // Ошибка генерации = худший кейс (F1=0, halluc=0): не теряем его из агрегата.
        const zero: EvalCaseResult = {
          id: fx.id,
          category: fx.category,
          specificity: fx.specificity,
          precision: 0,
          recall: 0,
          f1: 0,
          typeCorrectness: 0,
          entityBinding: 0,
          hallucinationRate: 0,
        };
        results.push(zero);
        metrics = zero;
      }

      perCaseDetails.push({
        id: fx.id,
        category: fx.category,
        specificity: fx.specificity,
        nlPrompt: fx.nlPrompt,
        golden: fx.golden,
        predicted,
        error,
        metrics,
      });

      console.log(
        `  ${String(i).padStart(3)}/${fixtures.length} ${fx.id.padEnd(14)} F1=${fmtPct(metrics.f1).padStart(6)} type=${fmtPct(metrics.typeCorrectness).padStart(6)} halluc=${fmtPct(metrics.hallucinationRate).padStart(6)} entity=${metrics.entityBinding}${error ? ` | ОШИБКА: ${error}` : ''}`,
      );
    }

    const agg = aggregate(results);

    console.log('\n========== Итоги ==========');
    console.log(`  Всего кейсов: ${agg.count}`);
    console.log(`  schema-F1:           ${fmtPct(agg.schemaF1)}`);
    console.log(`  precision:           ${fmtPct(agg.precision)}`);
    console.log(`  recall:              ${fmtPct(agg.recall)}`);
    console.log(`  type-correctness:    ${fmtPct(agg.typeCorrectness)}`);
    console.log(`  entity-binding:      ${fmtPct(agg.entityBinding)}`);
    console.log(`  hallucination-rate:  ${fmtPct(agg.hallucinationRate)}`);

    printBucketTable('По категориям', agg.byCategory);
    printBucketTable('По специфичности', agg.bySpecificity);

    const verdict = evaluateThresholds(agg);
    console.log(
      `\n  Пороги: F1 ≥ ${THRESHOLDS.schemaF1Min}, hallucination ≤ ${THRESHOLDS.hallucinationRateMax}`,
    );

    // Отчёты JSON + CSV.
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const jsonPath = path.join(REPORTS_DIR, `result-${timestamp}.json`);
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          timestamp,
          tenantId,
          totalCases: agg.count,
          thresholds: THRESHOLDS,
          pass: verdict.pass,
          failReasons: verdict.reasons,
          aggregate: agg,
          cases: perCaseDetails,
        },
        null,
        2,
      ),
      'utf-8',
    );

    const csvHeader =
      'id,category,specificity,precision,recall,f1,typeCorrectness,entityBinding,hallucinationRate,error';
    const csvRows = perCaseDetails.map((d) => {
      const m = d.metrics;
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [
        d.id,
        d.category,
        d.specificity,
        m?.precision.toFixed(4) ?? '0',
        m?.recall.toFixed(4) ?? '0',
        m?.f1.toFixed(4) ?? '0',
        m?.typeCorrectness.toFixed(4) ?? '0',
        m?.entityBinding ?? '0',
        m?.hallucinationRate.toFixed(4) ?? '0',
        esc(d.error ?? ''),
      ].join(',');
    });
    const csvPath = path.join(REPORTS_DIR, `result-${timestamp}.csv`);
    await fs.writeFile(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf-8');

    console.log(`\n  Отчёты:\n    ${jsonPath}\n    ${csvPath}`);

    if (verdict.pass) {
      console.log(
        '\n  ✓ PASS — пороги выдержаны, feature-flag можно включать.\n',
      );
    } else {
      console.log('\n  ✗ FAIL:');
      for (const r of verdict.reasons) console.log(`    - ${r}`);
      console.log('  feature-flag ВКЛЮЧАТЬ НЕЛЬЗЯ.\n');
    }

    await app.close();
    if (!verdict.pass) process.exit(1);
  } catch (e) {
    await app.close();
    throw e;
  }
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
