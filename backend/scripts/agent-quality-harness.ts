/**
 * agent-quality-harness — GOLDEN-ХАРНЕСС КАЧЕСТВА ИЗВЛЕЧЕНИЯ задач/решений.
 *
 * Регрессионный ИЗМЕРИТЕЛЬ (не фикс): прогоняет эталонные транскрипты
 * (чистые + ASR-гарблед) через РЕАЛЬНЫЙ AI-пайплайн встречи и считает
 * полноту/точность/долю дублей извлечённых задач и решений против golden.
 * Записывает baseline-снимок и печатает дельту ДО/ПОСЛЕ.
 *
 * Строится на готовом `_lib/combat-harness.ts`: prod-guard (`ALLOW_PROD`),
 * bootstrap/teardown синтетического тенанта, `createPrismaClient`, тот же
 * паттерн внешнего инжектора + поллера.
 *
 * ВАЖНО (как и combat-harness): backend С ВОРКЕРАМИ должен быть УЖЕ запущен
 * (`bun run dev` + `bun run worker:dev`, или `docker compose up -d backend`).
 * Этот скрипт — ВНЕШНИЙ инжектор + поллер, он НЕ поднимает свой Nest-контекст
 * (иначе второй раз зарегистрирует те же BullMQ-воркеры). Никакого
 * `NestFactory.create`.
 *
 * Запуск (из backend/, нужен живой backend+LLM):
 *   bun run scripts/agent-quality-harness.ts
 *   FIXTURES_GLOB='scripts/fixtures/agent-golden/sales-*.json' bun run scripts/agent-quality-harness.ts
 *   BASELINE_PATH=scripts/fixtures/agent-golden/.baseline.json VERIFY_TIMEOUT_MS=180000 \
 *     bun run scripts/agent-quality-harness.ts
 *   ALLOW_PROD=1 ...   # осознанный обход prod-guard
 *
 * НЕ регистрируется в apply-prod-deploy.ts STEPS — это QA-инструмент (как combat-harness).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import {
  type HarnessConfig,
  type HarnessInfra,
  type SyntheticTenant,
  assertNotProd,
  bootstrapTenant,
  makeInfra,
  pseudoUlid,
  readConfig,
  sleep,
  teardownTenant,
  upsertSource,
} from './_lib/combat-harness';
import {
  type ExtractionScore,
  type GoldenTask,
  type VariantScore,
  formatDelta,
  readBaseline,
  scoreDecisions,
  scoreExtraction,
  writeBaseline,
} from './_lib/agent-scoring';

function log(msg: string): void {
  console.log(msg);
}

// ───────────────────────── fixtures ────────────────────────────────

interface FixtureTurn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

interface GoldenFixture {
  id: string;
  variant: string;
  title?: string;
  meetingType?: string;
  transcript: { turns: FixtureTurn[] };
  golden: { tasks: GoldenTask[]; decisions: string[] };
}

const FIXTURES_DIR = 'scripts/fixtures/agent-golden';

/**
 * Загрузка фикстур из `scripts/fixtures/agent-golden/*.json`. Зависимость на
 * `glob` не тянем — берём `readdirSync` + фильтр (как scripts/eval/*).
 * `FIXTURES_GLOB` (опц.) — подстрока-фильтр по имени файла (напр. `sales-` или
 * `clean`), чтобы прогнать подмножество; пусто → все *.json.
 */
function loadFixtures(): GoldenFixture[] {
  const dir = resolve(process.cwd(), FIXTURES_DIR);
  const filter = process.env['FIXTURES_GLOB'];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .filter((f) => (filter ? f.includes(filter) : true))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `[agent-quality-harness] не найдено фикстур в '${FIXTURES_DIR}'` +
        (filter ? ` по фильтру '${filter}'` : ''),
    );
  }
  const out: GoldenFixture[] = [];
  for (const f of files) {
    const raw = readFileSync(resolve(dir, f), 'utf8');
    const fx = JSON.parse(raw) as GoldenFixture;
    if (!fx.transcript?.turns?.length) {
      throw new Error(`[agent-quality-harness] фикстура '${f}' без transcript.turns`);
    }
    out.push(fx);
  }
  return out;
}

// ───────────────────────── meeting injector ────────────────────────

// Имя очереди AI-analyze — зеркало src/modules/ai/queues.ts QUEUE_NAMES.ANALYZE.
// Не импортируем из ../src чтобы не тянуть Nest-граф в внешний инжектор.
const ANALYZE_QUEUE = 'ai.analyze';

/**
 * Прямой вброс Meeting + Transcript(turns) и enqueue `ai.analyze` ровно так,
 * как это делает FSM встречи после транскрибации. Зеркалит структуру локального
 * `injectMeetingDirect` из smoke-pipeline-e2e.ts, но:
 *   - кладёт реальные turns фикстуры;
 *   - выставляет Meeting.status='transcription_ready' (предусловие analyze.worker);
 *   - вместо RawEvent(meeting) для knowledge-core ставит job в `ai.analyze`,
 *     чтобы прошёл ПОЛНЫЙ AI-отчёт-путь: summary → structuredData → Task →
 *     transition ai_ready (именно его и меряет golden-харнесс).
 *
 * jobId формата `analyze:<meetingId>:<attempt>` — как в AiQueueService (':'
 * допустим вне dispatch-дедупа; attempt=1 первичная постановка).
 */
async function injectMeetingForAnalyze(
  infra: HarnessInfra,
  analyzeQueue: Queue,
  t: SyntheticTenant,
  fx: GoldenFixture,
): Promise<string> {
  const { prisma } = infra;
  await upsertSource(prisma, {
    tenantId: t.orgId,
    type: 'meeting',
    name: 'Golden-харнесс встречи',
  });
  const meetingId = pseudoUlid();
  const startedAt = new Date(Date.now() - 30 * 60_000);
  const endedAt = new Date();
  const turns = fx.transcript.turns;
  const totalWords = turns.reduce(
    (acc, x) => acc + x.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  const totalDurationSeconds = turns.reduce((m, x) => Math.max(m, x.endSec), 0);
  const meetingType = (fx.meetingType ?? 'team') as never;

  await prisma.meeting.create({
    data: {
      id: meetingId,
      roomName: meetingId, // @unique, равен id
      title: fx.title ?? `Golden ${fx.id}/${fx.variant} ${t.tag}`,
      type: meetingType,
      tenantId: t.orgId,
      ownerId: t.userId,
      status: 'transcription_ready', // предусловие analyze.worker
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      transcript: {
        create: {
          turns: turns as unknown as Prisma.InputJsonValue,
          roomChat: [] as unknown as Prisma.InputJsonValue,
          totalWords,
          totalDurationSeconds,
        },
      },
    },
  });

  await analyzeQueue.add(
    'analyze',
    { meetingId, attempt: 1 },
    { jobId: `analyze:${meetingId}:1` },
  );
  return meetingId;
}

/** Поллинг Meeting.status до ai_ready/ai_failed/failed или таймаута. */
async function pollMeetingReady(
  infra: HarnessInfra,
  meetingId: string,
  timeoutMs: number,
  intervalMs = 1500,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let status = 'unknown';
  while (Date.now() < deadline) {
    const m = await infra.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { status: true },
    });
    status = m?.status ?? 'unknown';
    if (status === 'ai_ready' || status === 'ai_failed' || status === 'failed') {
      return status;
    }
    await sleep(intervalMs);
  }
  return status;
}

// ───────────────────────── extraction read ─────────────────────────

interface ExtractedResult {
  taskTitles: string[];
  decisions: string[];
}

/** Достаёт массив строк из произвольного места structuredData по набору ключей. */
function pickStringArray(obj: unknown, keys: string[]): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (Array.isArray(v)) {
      return v
        .map((x) =>
          typeof x === 'string'
            ? x
            : x && typeof x === 'object' && 'title' in (x as object)
              ? String((x as { title: unknown }).title)
              : x && typeof x === 'object' && 'text' in (x as object)
                ? String((x as { text: unknown }).text)
                : '',
        )
        .filter((s) => s.length > 0);
    }
  }
  return [];
}

/**
 * Читает фактически извлечённое: Task.title (по meetingId) для задач,
 * AiResult.structuredData.decisions для решений (с tolerant-fallback по ключам).
 */
async function readExtraction(
  infra: HarnessInfra,
  meetingId: string,
): Promise<ExtractedResult> {
  const tasks = await infra.prisma.task.findMany({
    where: { meetingId },
    select: { title: true },
  });
  const aiResult = await infra.prisma.aiResult.findUnique({
    where: { meetingId },
    select: { structuredData: true },
  });
  const sd = aiResult?.structuredData ?? null;
  const decisions = pickStringArray(sd, ['decisions', 'решения', 'decision']);
  // Если Task пуст (tasks-extract ещё не отработал/выключен) — fallback на
  // structuredData.tasks, чтобы харнесс мерял хоть что-то.
  let taskTitles = tasks.map((x) => x.title).filter(Boolean);
  if (taskTitles.length === 0) {
    taskTitles = pickStringArray(sd, ['tasks', 'задачи', 'action_items']);
  }
  return { taskTitles, decisions };
}

// ───────────────────────── aggregate ───────────────────────────────

interface PerFixtureScore {
  fixtureId: string;
  variant: string;
  tasks: ExtractionScore;
  decisions: ExtractionScore;
}

/** Среднее по группе ExtractionScore (для агрегата по variant). */
function avgScores(scores: ExtractionScore[]): ExtractionScore {
  if (scores.length === 0) {
    return {
      completeness: 0,
      precision: 0,
      dupeRate: 0,
      matched: 0,
      missing: [],
      spurious: [],
    };
  }
  const sum = (sel: (s: ExtractionScore) => number) =>
    scores.reduce((a, s) => a + sel(s), 0) / scores.length;
  return {
    completeness: sum((s) => s.completeness),
    precision: sum((s) => s.precision),
    dupeRate: sum((s) => s.dupeRate),
    matched: scores.reduce((a, s) => a + s.matched, 0),
    missing: scores.flatMap((s) => s.missing),
    spurious: scores.flatMap((s) => s.spurious),
  };
}

function fmtScore(s: ExtractionScore): string {
  const r = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
  return (
    `completeness=${r(s.completeness)} precision=${r(s.precision)} ` +
    `dupeRate=${r(s.dupeRate)} matched=${s.matched}`
  );
}

function buildVariantScores(rows: PerFixtureScore[]): VariantScore[] {
  const byVariant = new Map<string, PerFixtureScore[]>();
  for (const r of rows) {
    const arr = byVariant.get(r.variant) ?? [];
    arr.push(r);
    byVariant.set(r.variant, arr);
  }
  const out: VariantScore[] = [];
  for (const [variant, group] of [...byVariant.entries()].sort()) {
    out.push({
      variant,
      fixtures: group.length,
      tasks: avgScores(group.map((g) => g.tasks)),
      decisions: avgScores(group.map((g) => g.decisions)),
    });
  }
  return out;
}

// ───────────────────────── main ────────────────────────────────────

async function main(): Promise<void> {
  const cfg: HarnessConfig = readConfig();
  assertNotProd(cfg);

  log('=== agent-quality-harness START (golden extraction quality) ===');
  const fixtures = loadFixtures();
  log(`✓ загружено фикстур: ${fixtures.length}`);

  const infra = makeInfra(cfg);
  const analyzeQueue = new Queue(ANALYZE_QUEUE, { connection: infra.redis });
  let tenant: SyntheticTenant | null = null;

  try {
    tenant = await bootstrapTenant(infra.prisma);
    log(`✓ синтетический тенант: Org=${tenant.orgId} tag=${tenant.tag}`);

    const rows: PerFixtureScore[] = [];

    for (const fx of fixtures) {
      const label = `${fx.id}/${fx.variant}`;
      log(`\n— [${label}] вброс Meeting + enqueue ai.analyze…`);
      const meetingId = await injectMeetingForAnalyze(infra, analyzeQueue, tenant, fx);
      const finalStatus = await pollMeetingReady(infra, meetingId, cfg.verifyTimeoutMs);
      log(`  [${label}] status=${finalStatus}`);
      // добор: tasks-extract идёт ОТДЕЛЬНОЙ job'ой после ai_ready.
      await sleep(Math.min(15_000, cfg.verifyTimeoutMs / 4));

      const extracted = await readExtraction(infra, meetingId);
      log(
        `  [${label}] извлечено: tasks=${extracted.taskTitles.length} decisions=${extracted.decisions.length}`,
      );

      const taskScore = scoreExtraction(fx.golden.tasks, extracted.taskTitles);
      const decisionScore = scoreDecisions(fx.golden.decisions, extracted.decisions);
      log(`  [${label}] tasks     ${fmtScore(taskScore)}`);
      log(`  [${label}] decisions ${fmtScore(decisionScore)}`);
      if (taskScore.missing.length > 0) {
        log(`  [${label}] missing tasks: ${taskScore.missing.join(' | ')}`);
      }

      rows.push({
        fixtureId: fx.id,
        variant: fx.variant,
        tasks: taskScore,
        decisions: decisionScore,
      });
    }

    // Агрегат по variant (clean vs asr_garbled).
    const variantScores = buildVariantScores(rows);
    log('\n=== Агрегат по variant ===');
    for (const v of variantScores) {
      log(`[${v.variant}] (фикстур: ${v.fixtures})`);
      log(`  tasks     ${fmtScore(v.tasks)}`);
      log(`  decisions ${fmtScore(v.decisions)}`);
    }

    // Baseline + дельта.
    const baselinePath =
      process.env['BASELINE_PATH'] ??
      resolve(process.cwd(), 'scripts/fixtures/agent-golden/.baseline.json');
    const prev = readBaseline(baselinePath);
    log('\n' + formatDelta(prev, variantScores));
    writeBaseline(baselinePath, variantScores);
    log(`✓ baseline записан: ${basename(baselinePath)}`);
  } catch (err) {
    console.error('agent-quality-harness FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (tenant && !cfg.keepTenant) {
      await teardownTenant(infra.prisma, tenant).catch(() => undefined);
      log('✓ teardown синтетического тенанта готов');
    } else if (tenant) {
      log(`⚠ KEEP_TENANT=1 — тенант НЕ удалён. Org=${tenant.orgId}.`);
    }
    await analyzeQueue.close().catch(() => undefined);
    await infra.close();
  }
}

void main();
