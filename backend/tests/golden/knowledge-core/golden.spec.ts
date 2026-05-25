import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GOLDEN_CONFIG,
  isGoldenExpected,
  isGoldenMeeting,
  type GoldenExpected,
  type GoldenExpectedBlock,
  type GoldenMeeting,
} from './fixtures/golden.config';

/**
 * Golden-set knowledge-core — regression suite.
 *
 * ТЗ: `plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md`,
 * раздел «W2.1 — Golden-set + regression».
 *
 * Что делает:
 *   1. Сканирует `meetings/*.json` (RawEvent-подобные фикстуры).
 *   2. Для каждой грузит `expected/<id>.expected.json` (ожидания разметки).
 *   3. Прогоняет реальный `BlockExtractionService` (bootstrap NestJS-контекста
 *      делается лениво при первом use) и сравнивает с ожиданиями.
 *   4. Считает 4 метрики из ТЗ §W2.1 и сверяет с порогами из `GOLDEN_CONFIG`.
 *   5. Печатает summary в stdout (CI-friendly).
 *
 * Что НЕ делает в S1 (Scaffolding):
 *   - Не бутстрапит NestJS-модуль. Это случится в S2, когда добавятся первые
 *     размеченные встречи. Сейчас фактической LLM-зависимости нет —
 *     `runExtraction(...)` помечен TODO и suite skip'ается, пока встреч < 1.
 *
 * Поведение:
 *   - `meetings/` пустая → ВСЕ it() помечаются skip с понятным сообщением,
 *     suite зелёная (нужно, чтобы CI не падал до первой ручной разметки).
 *   - meetings/ < `GOLDEN_CONFIG.minMeetingsForRun` (50) → один WARNING
 *     в stdout, но suite всё равно прогоняет имеющиеся (для отладки).
 *   - meetings/ ≥ 50 → полный прогон, fail при недостижении порогов.
 */

const GOLDEN_ROOT = resolve(__dirname);
const MEETINGS_DIR = resolve(GOLDEN_ROOT, 'meetings');
const EXPECTED_DIR = resolve(GOLDEN_ROOT, 'expected');

interface GoldenPair {
  meeting: GoldenMeeting;
  expected: GoldenExpected;
  meetingFile: string;
  expectedFile: string;
}

/**
 * Сканирует `meetings/` и для каждой `.json`-фикстуры подбирает парный
 * `expected/<id>.expected.json`. Возвращает только полные пары — встречи без
 * expected (и наоборот) логирует, но не валит загрузку (это разметочные
 * ошибки, их ловит отдельный тест-проверка ниже).
 */
function loadGoldenPairs(): GoldenPair[] {
  if (!existsSync(MEETINGS_DIR)) return [];
  const files = readdirSync(MEETINGS_DIR).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_'),
  );
  const pairs: GoldenPair[] = [];
  for (const meetingFile of files) {
    const meetingPath = resolve(MEETINGS_DIR, meetingFile);
    let meeting: unknown;
    try {
      meeting = JSON.parse(readFileSync(meetingPath, 'utf-8'));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[golden] не удалось распарсить ${meetingFile}: ${String(err)}`);
      continue;
    }
    if (!isGoldenMeeting(meeting)) {
      // eslint-disable-next-line no-console
      console.warn(`[golden] ${meetingFile} не соответствует GoldenMeeting`);
      continue;
    }
    const expectedFile = `${meeting.id}.expected.json`;
    const expectedPath = resolve(EXPECTED_DIR, expectedFile);
    if (!existsSync(expectedPath)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[golden] нет expected-файла для ${meeting.id} (ожидался ${expectedFile})`,
      );
      continue;
    }
    let expected: unknown;
    try {
      expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[golden] не удалось распарсить expected ${expectedFile}: ${String(err)}`,
      );
      continue;
    }
    if (!isGoldenExpected(expected)) {
      // eslint-disable-next-line no-console
      console.warn(`[golden] ${expectedFile} не соответствует GoldenExpected`);
      continue;
    }
    pairs.push({ meeting, expected, meetingFile, expectedFile });
  }
  return pairs;
}

// ───────────────── метрики ─────────────────

/**
 * Макро-F1 по signalType. Для каждого класса в union ожидаемых ∪ предсказанных
 * считаем precision/recall/F1, потом усредняем (unweighted macro).
 */
function macroF1SignalType(
  predicted: Array<{ signalType: string }>,
  expectedBlocks: GoldenExpectedBlock[],
): number {
  const classes = new Set<string>();
  for (const p of predicted) classes.add(p.signalType);
  for (const e of expectedBlocks) classes.add(e.signalType);
  if (classes.size === 0) return 1;
  const f1s: number[] = [];
  for (const cls of classes) {
    const tp = predicted.filter((p) => p.signalType === cls).length;
    const fp =
      predicted.filter((p) => p.signalType === cls).length -
      Math.min(
        tp,
        expectedBlocks.filter((e) => e.signalType === cls).length,
      );
    const fn =
      expectedBlocks.filter((e) => e.signalType === cls).length -
      Math.min(
        tp,
        expectedBlocks.filter((e) => e.signalType === cls).length,
      );
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 =
      precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    f1s.push(f1);
  }
  return f1s.reduce((a, b) => a + b, 0) / f1s.length;
}

/**
 * Cosine similarity между двумя нормализованными векторами одинаковой длины.
 * Используем при сравнении embedding'ов имени блока.
 */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) * (a[i] ?? 0);
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ───────────────── фасад прогона ─────────────────

/**
 * S1 (scaffolding) — заглушка. В S2/S3 здесь:
 *   - bootstrap NestJS Testing-модуля с реальными провайдерами knowledge-core;
 *   - вызов `BlockExtractionService.extractFull({...})` на segments из payload;
 *   - вызов `KnowledgeEmbeddingService` для name-embeddings;
 *   - формирование SearchService-запросов для top-3.
 *
 * Сейчас функция намеренно бросает — но she вызывается только когда
 * `pairs.length > 0`, а до первой реальной разметки `pairs.length === 0`.
 */
async function runKnowledgeCorePipeline(_meeting: GoldenMeeting): Promise<{
  predictedBlocks: Array<{ name: string; signalType: string; embedding?: number[] }>;
  predictedEntities: Array<{ type: string; canonicalName: string }>;
  searchTopK: (q: string) => Promise<string[]>;
  nameEmbedding: (text: string) => Promise<number[]>;
}> {
  throw new Error(
    'runKnowledgeCorePipeline пока не реализован — добавится в S2 одновременно с первой ручной разметкой meetings/*.json.',
  );
}

// ───────────────── suite ─────────────────

const pairs = loadGoldenPairs();

describe('golden knowledge-core regression (W2.1)', () => {
  it('консистентность golden-set (структура файлов)', () => {
    if (!existsSync(MEETINGS_DIR) || !existsSync(EXPECTED_DIR)) {
      // eslint-disable-next-line no-console
      console.log(
        '[golden] директории meetings/ и/или expected/ ещё не созданы — пропускаю проверку.',
      );
      return;
    }
    const meetingFiles = readdirSync(MEETINGS_DIR).filter(
      (f) => f.endsWith('.json') && !f.startsWith('_'),
    );
    const expectedFiles = new Set(
      readdirSync(EXPECTED_DIR).filter(
        (f) => f.endsWith('.expected.json') && !f.startsWith('_'),
      ),
    );
    for (const m of meetingFiles) {
      const raw = JSON.parse(readFileSync(resolve(MEETINGS_DIR, m), 'utf-8'));
      expect(
        isGoldenMeeting(raw),
        `meetings/${m} не соответствует GoldenMeeting`,
      ).toBe(true);
      const expectedName = `${(raw as GoldenMeeting).id}.expected.json`;
      expect(
        expectedFiles.has(expectedName),
        `нет expected/${expectedName} для meetings/${m}`,
      ).toBe(true);
    }
  });

  if (pairs.length === 0) {
    it.skip(
      'golden-set пуст — добавьте размеченные встречи в backend/tests/golden/knowledge-core/meetings/ (см. README.md)',
      () => {
        // no-op: помечается skip самим it.skip
      },
    );
    return;
  }

  if (pairs.length < GOLDEN_CONFIG.minMeetingsForRun) {
    // eslint-disable-next-line no-console
    console.warn(
      `[golden] WARNING: размечено ${pairs.length} встреч, минимум для блокирующего прогона — ${GOLDEN_CONFIG.minMeetingsForRun}. Метрики посчитаются, но релизный gate не сработает.`,
    );
  }

  // Глобальные накопители для финального summary.
  const perMeeting: Array<{
    id: string;
    signalTypeF1: number;
    entityRecallAt10: number;
    blockNameCosineSimilarity: number;
    top3SearchHitRate: number | null;
  }> = [];

  for (const pair of pairs) {
    describe(pair.meeting.id, () => {
      it('метрики качества выше порогов', async () => {
        const pipeline = await runKnowledgeCorePipeline(pair.meeting);

        // 1. signalType macro-F1
        const f1 = macroF1SignalType(pipeline.predictedBlocks, pair.expected.blocks);

        // 2. entity recall@10
        const top10 = pipeline.predictedEntities.slice(0, 10);
        const expectedEnts = pair.expected.entities;
        const matched = expectedEnts.filter((exp) =>
          top10.some(
            (p) =>
              p.type === exp.type &&
              (p.canonicalName.toLowerCase() === exp.canonicalName.toLowerCase() ||
                (exp.aliases ?? []).some(
                  (a) => a.toLowerCase() === p.canonicalName.toLowerCase(),
                )),
          ),
        ).length;
        const entityRecall = expectedEnts.length > 0 ? matched / expectedEnts.length : 1;

        // 3. block name cosine — усреднённый по парам (i-й предсказанный с i-м ожидаемым,
        // greedy-матчинг по точному signalType в S2; пока — naive по индексу).
        let nameCosine = 1;
        const cosScores: number[] = [];
        const N = Math.min(
          pipeline.predictedBlocks.length,
          pair.expected.blocks.length,
        );
        for (let i = 0; i < N; i++) {
          const predicted = pipeline.predictedBlocks[i];
          const expectedBlock = pair.expected.blocks[i];
          if (!predicted || !expectedBlock) continue;
          const predVec = predicted.embedding ?? (await pipeline.nameEmbedding(predicted.name));
          const expVec = await pipeline.nameEmbedding(expectedBlock.name);
          cosScores.push(cosine(predVec, expVec));
        }
        if (cosScores.length > 0) {
          nameCosine = cosScores.reduce((a, b) => a + b, 0) / cosScores.length;
        }

        // 4. top-3 search hit rate (опц. — есть searchQueries)
        let topHit: number | null = null;
        const queries = pair.expected.searchQueries ?? [];
        if (queries.length > 0) {
          let hits = 0;
          for (const q of queries) {
            const top3 = await pipeline.searchTopK(q.q);
            if (top3.slice(0, 3).includes(q.expectedBlockId)) hits++;
          }
          topHit = hits / queries.length;
        }

        perMeeting.push({
          id: pair.meeting.id,
          signalTypeF1: f1,
          entityRecallAt10: entityRecall,
          blockNameCosineSimilarity: nameCosine,
          top3SearchHitRate: topHit,
        });

        expect(f1, `signalType macro-F1 ниже порога для ${pair.meeting.id}`).toBeGreaterThanOrEqual(
          GOLDEN_CONFIG.thresholds.signalTypeMacroF1,
        );
        expect(
          entityRecall,
          `entity recall@10 ниже порога для ${pair.meeting.id}`,
        ).toBeGreaterThanOrEqual(GOLDEN_CONFIG.thresholds.entityRecallAt10);
        expect(
          nameCosine,
          `block name cosine ниже порога для ${pair.meeting.id}`,
        ).toBeGreaterThanOrEqual(GOLDEN_CONFIG.thresholds.blockNameCosineSimilarity);
        if (topHit !== null) {
          expect(
            topHit,
            `top-3 search hit rate ниже порога для ${pair.meeting.id}`,
          ).toBeGreaterThanOrEqual(GOLDEN_CONFIG.thresholds.top3SearchHitRate);
        }
      });
    });
  }

  it('сводка по golden-set', () => {
    if (perMeeting.length === 0) return;
    const avg = (key: keyof (typeof perMeeting)[number]) => {
      const vals = perMeeting
        .map((m) => m[key])
        .filter((v): v is number => typeof v === 'number');
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    // eslint-disable-next-line no-console
    console.log('[golden] summary:');
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          version: GOLDEN_CONFIG.version,
          meetings: perMeeting.length,
          thresholds: GOLDEN_CONFIG.thresholds,
          averages: {
            signalTypeF1: avg('signalTypeF1'),
            entityRecallAt10: avg('entityRecallAt10'),
            blockNameCosineSimilarity: avg('blockNameCosineSimilarity'),
            top3SearchHitRate: avg('top3SearchHitRate'),
          },
        },
        null,
        2,
      ),
    );
  });
});
