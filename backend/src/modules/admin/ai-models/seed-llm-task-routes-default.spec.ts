/**
 * Фаза A.4 — unit-тест на seed-llm-task-routes-default.ts.
 *
 * Источник массива ROUTES — `backend/scripts/seed-llm-task-routes-default.ts`.
 * Чтобы не тащить prisma-client при импорте, тест читает файл как текст,
 * извлекает все taskType + tier'ы через regex и валидирует структуру:
 *   1) ≥28 taskType'ов.
 *   2) У каждого ровно по 3 tier'а (primary/secondary/tertiary).
 *   3) Tertiary всегда gemini-3.1-pro через kie (2026-06-05; ollama убран).
 *   4) Дубликатов taskType нет.
 *
 * Это дешевле, чем вытаскивать `ROUTES` в отдельный файл. При желании в Фазе
 * E можно зарефакторить в shared-config.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SEED_PATH = join(__dirname, '..', '..', '..', '..', 'scripts', 'seed-llm-task-routes-default.ts');

function parseSeedFile(): Array<{
  taskType: string;
  tiers: Array<{ tier: string; providerName: string; model: string }>;
}> {
  const text = readFileSync(SEED_PATH, 'utf8');
  // Грубый, но устойчивый парс: ищем `taskType: '...',` и за ним блок `chain: [ ... ]`.
  const taskTypeRe = /taskType:\s*'([^']+)',\s*group:[^,]+,\s*playbookSection:[^,]+,\s*chain:\s*\[([\s\S]*?)\],\s*\}/g;
  const tierRe = /\{\s*tier:\s*'(primary|secondary|tertiary)',\s*providerName:\s*'([^']+)',\s*model:\s*'([^']+)'\s*\}/g;
  const result: Array<{
    taskType: string;
    tiers: Array<{ tier: string; providerName: string; model: string }>;
  }> = [];
  for (const m of text.matchAll(taskTypeRe)) {
    const taskType = m[1];
    const chainBody = m[2];
    if (!taskType || !chainBody) continue;
    const tiers: Array<{ tier: string; providerName: string; model: string }> = [];
    for (const t of chainBody.matchAll(tierRe)) {
      tiers.push({
        tier: t[1] as string,
        providerName: t[2] as string,
        model: t[3] as string,
      });
    }
    result.push({ taskType, tiers });
  }
  return result;
}

describe('seed-llm-task-routes-default — структура цепочек', () => {
  const seeds = parseSeedFile();

  it('минимум 28 taskType-ов покрыто', () => {
    expect(seeds.length).toBeGreaterThanOrEqual(28);
  });

  it('у каждого taskType ровно 3 tier-а (primary, secondary, tertiary)', () => {
    for (const seed of seeds) {
      const tiers = seed.tiers.map((t) => t.tier).sort();
      expect(
        tiers,
        `taskType=${seed.taskType} должен иметь 3 tier-а, получили: ${tiers.join(',')}`,
      ).toEqual(['primary', 'secondary', 'tertiary']);
    }
  });

  it('tertiary всегда gemini-3.1-pro через kie', () => {
    for (const seed of seeds) {
      const tertiary = seed.tiers.find((t) => t.tier === 'tertiary');
      expect(tertiary, `taskType=${seed.taskType} без tertiary`).toBeDefined();
      expect(tertiary?.providerName).toBe('kie');
      expect(tertiary?.model).toBe('gemini-3.1-pro');
    }
  });

  it('taskType-ы уникальны', () => {
    const seen = new Set<string>();
    for (const seed of seeds) {
      expect(seen.has(seed.taskType), `Дубликат taskType=${seed.taskType}`).toBe(false);
      seen.add(seed.taskType);
    }
  });
});
