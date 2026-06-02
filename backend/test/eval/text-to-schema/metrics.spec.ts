/**
 * OFFLINE unit-тесты Eval Text-to-Schema (Smart-tables, Фаза 1.5).
 *
 * Два независимых блока, оба БЕЗ LLM:
 *   1. «метрики» — проверяют арифметику чистых функций из `metrics.ts` на
 *      синтетических golden/predicted (точное совпадение → f1=1; лишняя колонка
 *      → hallucination>0; пропуск → recall<1; неверный тип → typeCorrectness<1;
 *      mismatch entitySync → 0).
 *   2. «валидатор фикстур» — загружает все 6 JSON-файлов и гарантирует качество
 *      golden-набора в CI без обращения к LLM: ≥100 кейсов, валидные TablePropType,
 *      ровно одна isPrimary, entitySync ∈ {org,person,meeting,document,null},
 *      уникальные id.
 *
 * Полный прогон против реального LLM-прокси — отдельный runner
 * `backend/scripts/eval/run-text-to-schema-eval.ts` (требует proxy + Nest-контекст,
 * здесь НЕ запускается).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aggregate,
  computeCaseMetrics,
  entityBindingCorrectness,
  hallucinationRate,
  matchColumns,
  normalizeColumnName,
  schemaAccuracy,
  typeCorrectness,
  type EvalCaseResult,
  type EvalSchema,
} from './metrics';

// ────────────────────────────── блок 1: метрики ──────────────────────────────

describe('Text-to-Schema metrics — арифметика (offline)', () => {
  const golden: EvalSchema = {
    name: 'Клиенты',
    entitySync: { type: 'org' },
    properties: [
      { name: 'Название', type: 'text', isPrimary: true },
      { name: 'Контакт', type: 'person', isPrimary: false },
      { name: 'Телефон', type: 'phone', isPrimary: false },
      { name: 'Стадия', type: 'status', isPrimary: false },
    ],
  };

  it('normalizeColumnName: trim/lowercase/ё→е/схлопывание пробелов', () => {
    expect(normalizeColumnName('  Дата   Начала ')).toBe('дата начала');
    expect(normalizeColumnName('Объём')).toBe('объем');
    expect(normalizeColumnName('EMAIL')).toBe('email');
  });

  it('точное совпадение → precision=recall=f1=1, type=1, hallucination=0', () => {
    const predicted: EvalSchema = JSON.parse(JSON.stringify(golden));
    const acc = schemaAccuracy(golden, predicted);
    expect(acc.precision).toBe(1);
    expect(acc.recall).toBe(1);
    expect(acc.f1).toBe(1);
    expect(typeCorrectness(golden, predicted)).toBe(1);
    expect(hallucinationRate(golden, predicted)).toBe(0);
    expect(entityBindingCorrectness(golden, predicted)).toBe(1);
  });

  it('совпадение нечувствительно к регистру/пробелам', () => {
    const predicted: EvalSchema = {
      entitySync: { type: 'org' },
      properties: [
        { name: 'название', type: 'text' },
        { name: '  Контакт ', type: 'person' },
        { name: 'ТЕЛЕФОН', type: 'phone' },
        { name: 'Стадия', type: 'status' },
      ],
    };
    expect(schemaAccuracy(golden, predicted).f1).toBe(1);
  });

  it('лишняя (придуманная) колонка → hallucinationRate > 0, precision < 1', () => {
    const predicted: EvalSchema = {
      entitySync: { type: 'org' },
      properties: [
        { name: 'Название', type: 'text' },
        { name: 'Контакт', type: 'person' },
        { name: 'Телефон', type: 'phone' },
        { name: 'Стадия', type: 'status' },
        { name: 'Выдуманное поле', type: 'text' }, // нет в golden
      ],
    };
    const m = matchColumns(golden, predicted);
    expect(m.extra.length).toBe(1);
    expect(hallucinationRate(golden, predicted)).toBeCloseTo(1 / 5, 5);
    expect(schemaAccuracy(golden, predicted).precision).toBeCloseTo(4 / 5, 5);
    // recall не страдает: все golden-колонки найдены.
    expect(schemaAccuracy(golden, predicted).recall).toBe(1);
  });

  it('пропущенная колонка → recall < 1, hallucination = 0', () => {
    const predicted: EvalSchema = {
      entitySync: { type: 'org' },
      properties: [
        { name: 'Название', type: 'text' },
        { name: 'Контакт', type: 'person' },
        { name: 'Телефон', type: 'phone' },
        // «Стадия» пропущена
      ],
    };
    const acc = schemaAccuracy(golden, predicted);
    expect(acc.recall).toBeCloseTo(3 / 4, 5);
    expect(acc.precision).toBe(1);
    expect(hallucinationRate(golden, predicted)).toBe(0);
    expect(matchColumns(golden, predicted).missing.length).toBe(1);
  });

  it('неверный тип сопоставленной колонки → typeCorrectness < 1', () => {
    const predicted: EvalSchema = {
      entitySync: { type: 'org' },
      properties: [
        { name: 'Название', type: 'text' },
        { name: 'Контакт', type: 'text' }, // должен быть person
        { name: 'Телефон', type: 'phone' },
        { name: 'Стадия', type: 'status' },
      ],
    };
    // имена совпали все → f1=1, но один тип неверный.
    expect(schemaAccuracy(golden, predicted).f1).toBe(1);
    expect(typeCorrectness(golden, predicted)).toBeCloseTo(3 / 4, 5);
  });

  it('entitySync mismatch → entityBindingCorrectness = 0', () => {
    const predicted: EvalSchema = {
      entitySync: { type: 'person' }, // должно быть org
      properties: golden.properties,
    };
    expect(entityBindingCorrectness(golden, predicted)).toBe(0);
  });

  it('оба entitySync null → entityBindingCorrectness = 1', () => {
    const g: EvalSchema = { entitySync: null, properties: golden.properties };
    const p: EvalSchema = { properties: golden.properties }; // entitySync отсутствует
    expect(entityBindingCorrectness(g, p)).toBe(1);
  });

  it('пустой predicted → метрики 0, без NaN', () => {
    const predicted: EvalSchema = { entitySync: null, properties: [] };
    const acc = schemaAccuracy(golden, predicted);
    expect(acc.precision).toBe(0);
    expect(acc.recall).toBe(0);
    expect(acc.f1).toBe(0);
    expect(Number.isNaN(acc.f1)).toBe(false);
    expect(typeCorrectness(golden, predicted)).toBe(0);
    expect(hallucinationRate(golden, predicted)).toBe(0); // 0 extra / max(1,0)
  });

  it('дубль колонки в predicted матчится один раз, второй → extra', () => {
    const predicted: EvalSchema = {
      entitySync: { type: 'org' },
      properties: [
        { name: 'Название', type: 'text' },
        { name: 'Название', type: 'text' }, // дубль
        { name: 'Контакт', type: 'person' },
        { name: 'Телефон', type: 'phone' },
        { name: 'Стадия', type: 'status' },
      ],
    };
    const m = matchColumns(golden, predicted);
    expect(m.matched.length).toBe(4);
    expect(m.extra.length).toBe(1); // второй «Название»
  });

  it('aggregate: средние по набору + разбивка по category и specificity', () => {
    const results: EvalCaseResult[] = [
      {
        id: 'a-01',
        category: 'sales',
        specificity: 'low',
        precision: 1,
        recall: 1,
        f1: 1,
        typeCorrectness: 1,
        entityBinding: 1,
        hallucinationRate: 0,
      },
      {
        id: 'a-02',
        category: 'sales',
        specificity: 'high',
        precision: 0.8,
        recall: 0.6,
        f1: 0.6857,
        typeCorrectness: 0.5,
        entityBinding: 0,
        hallucinationRate: 0.2,
      },
      {
        id: 'b-01',
        category: 'hr',
        specificity: 'low',
        precision: 0.5,
        recall: 0.5,
        f1: 0.5,
        typeCorrectness: 1,
        entityBinding: 1,
        hallucinationRate: 0.5,
      },
    ];
    const agg = aggregate(results);
    expect(agg.count).toBe(3);
    expect(agg.schemaF1).toBeCloseTo((1 + 0.6857 + 0.5) / 3, 4);
    expect(agg.hallucinationRate).toBeCloseTo((0 + 0.2 + 0.5) / 3, 4);
    // по категориям
    expect(agg.byCategory.sales!.count).toBe(2);
    expect(agg.byCategory.hr!.count).toBe(1);
    expect(agg.byCategory.sales!.schemaF1).toBeCloseTo((1 + 0.6857) / 2, 4);
    // по специфичности
    expect(agg.bySpecificity.low!.count).toBe(2);
    expect(agg.bySpecificity.high!.count).toBe(1);
  });

  it('computeCaseMetrics: собирает все метрики разом для одного кейса', () => {
    const r = computeCaseMetrics({
      id: 'sales-01',
      category: 'sales',
      specificity: 'mid',
      golden,
      predicted: JSON.parse(JSON.stringify(golden)),
    });
    expect(r.id).toBe('sales-01');
    expect(r.f1).toBe(1);
    expect(r.typeCorrectness).toBe(1);
    expect(r.entityBinding).toBe(1);
    expect(r.hallucinationRate).toBe(0);
  });
});

// ──────────────────────── блок 2: валидатор фикстур ───────────────────────────

const FIXTURES_DIR = join(__dirname, 'fixtures');

// Должно совпадать с ALLOWED_PROP_TYPES в TableAgentService + практичным набором
// из ТЗ (без auto/служебных типов, которые LLM не задаёт напрямую).
const VALID_PROP_TYPES = new Set<string>([
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'status',
  'selectSingle',
  'selectMulti',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
]);

const VALID_SYNC_TYPES = new Set<string>(['org', 'person', 'meeting', 'document']);

const EXPECTED_CATEGORIES = ['hr', 'sales', 'product', 'ops', 'finance', 'marketing'];

interface GoldenColumn {
  name: string;
  type: string;
  isPrimary: boolean;
}
interface FixtureGolden {
  name: string;
  entitySync: { type: string } | null;
  properties: GoldenColumn[];
}
interface Fixture {
  id: string;
  category: string;
  specificity: string;
  nlPrompt: string;
  golden: FixtureGolden;
}

function loadAllFixtures(): { file: string; fixtures: Fixture[] }[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: f,
      fixtures: JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')) as Fixture[],
    }));
}

describe('Text-to-Schema fixtures — валидатор golden-набора (offline)', () => {
  const files = loadAllFixtures();
  const all: Fixture[] = files.flatMap((f) => f.fixtures);

  it('ровно 6 файлов фикстур по ожидаемым категориям', () => {
    expect(files.length).toBe(6);
    const fileNames = files.map((f) => f.file.replace('.json', '')).sort();
    expect(fileNames).toEqual([...EXPECTED_CATEGORIES].sort());
  });

  it('суммарно ≥ 100 кейсов', () => {
    expect(all.length).toBeGreaterThanOrEqual(100);
  });

  it('id уникальны во всём наборе', () => {
    const ids = all.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('покрыты все 3 уровня специфичности и присутствует ≥1 entitySync каждого типа', () => {
    const specs = new Set(all.map((f) => f.specificity));
    expect(specs).toEqual(new Set(['low', 'mid', 'high']));
    const syncTypes = new Set(
      all.map((f) => f.golden.entitySync?.type ?? 'null'),
    );
    // Покрываем и null, и все 4 entity-типа.
    expect(syncTypes.has('null')).toBe(true);
    for (const t of VALID_SYNC_TYPES) {
      expect(syncTypes.has(t)).toBe(true);
    }
  });

  for (const { file, fixtures } of files) {
    it(`${file}: ~17 кейсов, категория совпадает с именем файла`, () => {
      const cat = file.replace('.json', '');
      expect(fixtures.length).toBeGreaterThanOrEqual(15);
      for (const fx of fixtures) {
        expect(fx.category).toBe(cat);
      }
    });

    for (const fx of fixtures) {
      it(`фикстура ${fx.id}: структура и инварианты golden валидны`, () => {
        // базовые поля
        expect(fx.id).toMatch(/^[a-z]+-\d+$/);
        expect(['low', 'mid', 'high']).toContain(fx.specificity);
        expect(fx.nlPrompt.trim().length).toBeGreaterThan(0);

        const props = fx.golden.properties;
        // число колонок 3–8
        expect(props.length).toBeGreaterThanOrEqual(3);
        expect(props.length).toBeLessThanOrEqual(8);

        // ровно одна isPrimary
        const primaries = props.filter((p) => p.isPrimary === true);
        expect(primaries.length).toBe(1);

        // имя таблицы непустое
        expect(fx.golden.name.trim().length).toBeGreaterThan(0);

        // каждый type валиден, имена непустые
        for (const p of props) {
          expect(p.name.trim().length).toBeGreaterThan(0);
          expect(VALID_PROP_TYPES.has(p.type)).toBe(true);
        }

        // entitySync ∈ {org,person,meeting,document} или null
        if (fx.golden.entitySync !== null) {
          expect(VALID_SYNC_TYPES.has(fx.golden.entitySync.type)).toBe(true);
        }

        // имена колонок уникальны внутри схемы (после нормализации)
        const norm = props.map((p) =>
          p.name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '),
        );
        expect(new Set(norm).size).toBe(norm.length);
      });
    }
  }
});
