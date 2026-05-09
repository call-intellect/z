/**
 * Доменная модель CRM-карточки. Маппинг из ApiDto — `cardFromApi`.
 *
 * Контракт: `backend/src/modules/cards/`.
 */

export type CardKind = 'client' | 'deal' | 'project' | 'topic' | 'custom';

export const CARD_KIND_LABELS: Record<CardKind, string> = {
  client: 'Клиент',
  deal: 'Сделка',
  project: 'Проект',
  topic: 'Тема',
  custom: 'Прочее',
};

export type CardDomain = {
  id: string;
  name: string;
  kind: CardKind;
  color: string;
  icon: string | null;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  pinned: boolean;
  archivedAt: Date | null;
  /** AI rollup-кэш карточки (markdown). null если ещё не собирали. */
  summary: string | null;
  summaryUpdatedAt: Date | null;
  meetingCount: number;
  lastMeetingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CardApi = {
  id: string;
  name: string;
  kind: string;
  color: string;
  icon: string | null;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  pinned: boolean;
  archivedAt: string | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
  meetingCount: number;
  lastMeetingAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CardListApi = {
  items: CardApi[];
  page: number;
  limit: number;
  total: number;
};

export type CardMeetingItemApi = {
  id: string;
  title: string;
  type: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  createdAt: string;
};

export type CardMeetingsListApi = {
  items: CardMeetingItemApi[];
  page: number;
  limit: number;
  total: number;
};

const KNOWN_KINDS: ReadonlySet<string> = new Set([
  'client',
  'deal',
  'project',
  'topic',
  'custom',
]);

function parseKind(raw: string): CardKind {
  return KNOWN_KINDS.has(raw) ? (raw as CardKind) : 'custom';
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function cardFromApi(api: CardApi): CardDomain {
  return {
    id: api.id,
    name: api.name,
    kind: parseKind(api.kind),
    color: api.color,
    icon: api.icon,
    description: api.description,
    contactName: api.contactName,
    contactEmail: api.contactEmail,
    contactPhone: api.contactPhone,
    pinned: api.pinned,
    archivedAt: parseDate(api.archivedAt),
    summary: api.summary,
    summaryUpdatedAt: parseDate(api.summaryUpdatedAt),
    meetingCount: api.meetingCount,
    lastMeetingAt: parseDate(api.lastMeetingAt),
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}
