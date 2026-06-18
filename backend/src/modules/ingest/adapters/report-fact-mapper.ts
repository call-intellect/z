import type { MeetingType } from '@prisma/client';

export interface ReportFact {
  reportKind: 'decision' | 'risk' | 'pain' | 'task' | 'next_step' | 'blocker' | 'summary_point';
  text: string;
  speaker?: string;
}

export function mapStructuredToReportFacts(
  meetingType: MeetingType | string | null | undefined,
  structuredData: unknown,
): ReportFact[] {
  if (!isPlainObject(structuredData) || !meetingType) return [];
  const sd = structuredData;
  const facts: ReportFact[] = [];

  switch (meetingType) {
    case 'sales': {
      pushString(facts, 'pain', asStringOrNull(sd['pain']));
      pushStringArray(facts, 'risk', sd['objections']);
      pushStringArray(facts, 'summary_point', sd['competitors']);
      pushString(facts, 'next_step', asStringOrNull(sd['next_step']));
      pushString(facts, 'blocker', asStringOrNull(sd['main_blocker']));
      break;
    }
    case 'team': {
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
      for (const t of asArray(sd['tasks'])) {
        const text = asStringOrNull(isPlainObject(t) ? t['title'] : t);
        if (text) facts.push({ reportKind: 'task', text });
      }
      pushString(facts, 'next_step', asStringOrNull(sd['next_step']));
      break;
    }
    case 'standup': {
      pushStringArray(facts, 'decision', sd['decisions_needed']);
      pushStringArray(facts, 'blocker', sd['blockers']);
      pushStringArray(facts, 'task', sd['new_tasks']);
      pushStringArray(facts, 'summary_point', sd['priorities']);
      break;
    }
    case 'review': {
      pushStringArray(facts, 'risk', sd['risks']);
      pushStringArray(facts, 'decision', sd['decisions']);
      pushStringArray(facts, 'summary_point', sd['to_improve']);
      pushStringArray(facts, 'next_step', sd['next_steps']);
      break;
    }
    default:
      return [];
  }

  return facts;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function pushString(
  facts: ReportFact[],
  reportKind: ReportFact['reportKind'],
  text: string | null,
): void {
  if (text) facts.push({ reportKind, text });
}

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
