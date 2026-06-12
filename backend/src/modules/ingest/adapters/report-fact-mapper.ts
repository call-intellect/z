import type { MeetingType } from '@prisma/client';

/**
 * Гранулярный факт, извлечённый из структурного AI-отчёта встречи
 * (`AiResult.structuredData`) для заноса в граф знаний (knowledge-core).
 *
 * Каждый факт → отдельный сегмент в SegmentBuilder → отдельный IdeaBlock с
 * нужным signalType. Тип сигнала определит LLM-extraction; `reportKind` —
 * лишь продуктовая категория факта, на signalType блока напрямую не влияет.
 */
export interface ReportFact {
  reportKind:
    | 'decision'
    | 'risk'
    | 'pain'
    | 'task'
    | 'next_step'
    | 'blocker'
    | 'summary_point';
  text: string;
  /** Кто высказал/принял (только там, где структурный отчёт это хранит — team.decisions). */
  speaker?: string;
}

/**
 * Маппинг структурного отчёта по типу встречи → плоский массив гранулярных
 * фактов. ТОЛЬКО вариант Б (см. ТЗ 2026-06-11-report-to-graph-phase2.md §2.1):
 * каждый структурный вывод (решение / риск / боль / задача) идёт в граф
 * отдельным фактом с правильным reportKind.
 *
 * Принципы (ТЗ §2.1.2, §2.4):
 *   1. **Whitelist внутренних полей** — мапим ТОЛЬКО заранее известные поля
 *      Zod-схемы типа. Перебора всех ключей structuredData НЕТ. Это машинная
 *      граница D6: клиентский протокол `client_protocol_md` (top-level ключ в
 *      structuredData, см. analyze.worker.ts:346) НИКОГДА не читается → не
 *      попадает в граф.
 *   2. **Мягкая валидация** — каждое поле проверяется по факту (строка →
 *      берём как есть; объект `{text,...}` → берём `.text`). Невалидный/
 *      неизвестный тип встречи → пустой массив (graceful, не бросаем).
 *   3. **summaryFast и chapters здесь НЕ добавляются** — их кладёт адаптер
 *      (они одинаковы для всех типов и не зависят от структурной схемы).
 *
 * @param meetingType тип встречи (определяет применимую Zod-схему)
 * @param structuredData `AiResult.structuredData` (полиморфен по типу) либо null
 */
export function mapStructuredToReportFacts(
  meetingType: MeetingType | string | null | undefined,
  structuredData: unknown,
): ReportFact[] {
  if (!isPlainObject(structuredData) || !meetingType) return [];
  const sd = structuredData;
  const facts: ReportFact[] = [];

  switch (meetingType) {
    case 'sales': {
      // type-sales.ts: pain (string|null), objections[], competitors[]?,
      // next_step (string), main_blocker (string|null)?
      pushString(facts, 'pain', asStringOrNull(sd['pain']));
      pushStringArray(facts, 'risk', sd['objections']);
      pushStringArray(facts, 'summary_point', sd['competitors']);
      pushString(facts, 'next_step', asStringOrNull(sd['next_step']));
      pushString(facts, 'blocker', asStringOrNull(sd['main_blocker']));
      break;
    }
    case 'team': {
      // type-team.ts: decisions[]{text,speaker,changes_what}, blockers[],
      // tasks[]{title,...}, next_step (string|null)
      for (const d of asArray(sd['decisions'])) {
        const text = asStringOrNull(isPlainObject(d) ? d['text'] : d);
        if (!text) continue;
        const speaker = isPlainObject(d) ? asStringOrNull(d['speaker']) : null;
        facts.push({
          reportKind: 'decision',
          text,
          ...(speaker ? { speaker } : {}),
        });
      }
      pushStringArray(facts, 'blocker', sd['blockers']);
      // tasks — элементы объекты {title, ...}; берём title.
      for (const t of asArray(sd['tasks'])) {
        const text = asStringOrNull(isPlainObject(t) ? t['title'] : t);
        if (text) facts.push({ reportKind: 'task', text });
      }
      pushString(facts, 'next_step', asStringOrNull(sd['next_step']));
      break;
    }
    case 'standup': {
      // type-standup.ts: decisions_needed[], blockers[], new_tasks[], priorities[]
      pushStringArray(facts, 'decision', sd['decisions_needed']);
      pushStringArray(facts, 'blocker', sd['blockers']);
      pushStringArray(facts, 'task', sd['new_tasks']);
      pushStringArray(facts, 'summary_point', sd['priorities']);
      break;
    }
    case 'review': {
      // type-review.ts: risks[], decisions[]?, to_improve[], next_steps[]
      pushStringArray(facts, 'risk', sd['risks']);
      pushStringArray(facts, 'decision', sd['decisions']);
      pushStringArray(facts, 'summary_point', sd['to_improve']);
      pushStringArray(facts, 'next_step', sd['next_steps']);
      break;
    }
    default:
      // Неизвестный/непокрытый тип встречи — graceful: структурных фактов нет
      // (адаптер всё равно положит summaryFast + chapters).
      return [];
  }

  return facts;
}

// ─────────────────────────── helpers ────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Приводит к непустой строке либо null (числа/булевы → null — нам нужен текст). */
function asStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Возвращает массив как есть либо [] (мягко). */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Кладёт одиночный текст-факт, если он непуст. */
function pushString(
  facts: ReportFact[],
  reportKind: ReportFact['reportKind'],
  text: string | null,
): void {
  if (text) facts.push({ reportKind, text });
}

/**
 * Кладёт по факту на каждый непустой элемент массива строк. Элементы-объекты
 * `{text,...}` тоже поддержаны (берём `.text`) — на случай, если схема типа
 * хранит массив объектов, а не строк.
 */
function pushStringArray(
  facts: ReportFact[],
  reportKind: ReportFact['reportKind'],
  arr: unknown,
): void {
  for (const item of asArray(arr)) {
    const text = asStringOrNull(isPlainObject(item) ? item['text'] : item);
    if (text) facts.push({ reportKind, text });
  }
}
