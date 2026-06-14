/**
 * A9 (F8.5) — построение CSV «для планёрки» из недельного план-факта по людям.
 *
 * Чистая функция (тестируется в `__tests__/planerka-csv.test.ts`): плоская
 * таблица «одна строка на пункт», колонки в фиксированном порядке
 * Человек · Что · План · Факт · Что мешало. Имя человека повторяется в каждой
 * строке его пунктов; человек без пунктов даёт одну строку-заглушку «—».
 *
 * Эскейпинг и сборка переиспользуют `buildCsv`/`CsvColumn` из
 * `AdminCsvDownloadButton` (разделитель `;`, кавычки удваиваются, перевод
 * строки/`;`/кавычка → значение в `"…"`, перевод строк `\r\n`). BOM в файл
 * добавляется на этапе формирования Blob (см. виджет), здесь его НЕТ.
 */
import {
  buildCsv,
  type CsvColumn,
} from '@/ui/components/admin/AdminCsvDownloadButton';
import type { WeeklyPersonItemUi } from '@/domain/weekly-per-person';

/** Один человек со своими построчными пунктами план-факта за неделю. */
export interface PlanerkaPerson {
  personName: string;
  items: WeeklyPersonItemUi[];
}

/** Плоская строка CSV: одна на пункт. */
interface PlanerkaCsvRow extends Record<string, unknown> {
  person: string;
  what: string;
  plan: string;
  fact: string;
  blocked: string;
}

const COLUMNS: CsvColumn<PlanerkaCsvRow>[] = [
  { key: 'person', label: 'Человек' },
  { key: 'what', label: 'Что' },
  { key: 'plan', label: 'План' },
  { key: 'fact', label: 'Факт' },
  { key: 'blocked', label: 'Что мешало' },
];

/** Плоская таблица строк (по одной на пункт; человек без пунктов → «—»). */
export function buildPlanerkaRows(people: PlanerkaPerson[]): PlanerkaCsvRow[] {
  const out: PlanerkaCsvRow[] = [];
  for (const p of people) {
    if (p.items.length === 0) {
      out.push({
        person: p.personName,
        what: '—',
        plan: '—',
        fact: '—',
        blocked: '—',
      });
      continue;
    }
    for (const it of p.items) {
      out.push({
        person: p.personName,
        what: it.title,
        plan: it.plannedDueLabel,
        fact: it.factLabel,
        blocked: it.blockedBy ?? '—',
      });
    }
  }
  return out;
}

/** Готовый CSV (без BOM) для скачивания «для планёрки». */
export function buildPlanerkaCsv(people: PlanerkaPerson[]): string {
  return buildCsv(buildPlanerkaRows(people), COLUMNS);
}
