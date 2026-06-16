/**
 * Типы запросов и ответов Bitrix24 REST для синка-источника (ТЗ 2026-06-17).
 * Формы сверены с официальной докой (apidocs.bitrix24 / b24restdocs, Context7).
 *
 * ВАЖНО — регистр полей различается по подсистемам:
 *   - `user.get`, `crm.*`        → поля в ВЕРХНЕМ регистре (ID, NAME, EMAIL…).
 *   - `im.*` (recent/messages)   → поля в нижнем регистре (id, author_id, date…).
 * Значения часто приходят строкой (даже числовые ID) — нормализуем в сервисе.
 */

// ─────────────────────────── user.get ─────────────────────────────────────

/**
 * Параметры `user.get` (списочный, пагинация `start`). `type`-алиас (не
 * `interface`) — чтобы тип был присваиваем к `Record<string, unknown>` в
 * сигнатуре `callApi(List)` (у interface нет неявной индекс-сигнатуры).
 */
export type BitrixUserGetParams = {
  start?: number;
  FILTER?: Record<string, unknown>;
  SORT?: string;
  ORDER?: 'ASC' | 'DESC';
  ADMIN_MODE?: boolean;
};

/** Элемент ответа `user.get` (ВЕРХНИЙ регистр). */
export interface BitrixUser {
  ID: string;
  ACTIVE?: boolean;
  NAME?: string | null;
  LAST_NAME?: string | null;
  SECOND_NAME?: string | null;
  EMAIL?: string | null;
  WORK_POSITION?: string | null;
  UF_DEPARTMENT?: number[];
  [key: string]: unknown;
}

// ─────────────────────────── im.recent.get ────────────────────────────────

/** Параметры `im.recent.get`. `result` — массив диалогов (нижний регистр).
 *  `type`-алиас (см. BitrixUserGetParams) — для присваиваемости к Record. */
export type BitrixImRecentParams = {
  SKIP_OPENLINES?: 'Y' | 'N';
  SKIP_CHAT?: 'Y' | 'N';
  SKIP_DIALOG?: 'Y' | 'N';
  ONLY_OPENLINES?: 'Y' | 'N';
  LAST_UPDATE?: string;
  LAST_SYNC_DATE?: string;
};

export interface BitrixImRecentLastMessage {
  id?: number;
  text?: string;
  author_id?: number;
  date?: string;
}

/** Элемент `im.recent.get` (нижний регистр). `id` — это dialog_id. */
export interface BitrixImRecentItem {
  id: string; // dialog_id: числовой (личный) или `chatXXX` (групповой/ОЛ)
  type: 'user' | 'chat' | 'openline' | string;
  title?: string;
  chat_id?: number;
  last_id?: number;
  date_update?: string;
  date_last_activity?: string;
  message?: BitrixImRecentLastMessage;
  [key: string]: unknown;
}

// ─────────────────────────── im.dialog.messages.get ───────────────────────

/** Параметры `im.dialog.messages.get` (DIALOG_ID = `chatXXX`/userId).
 *  `type`-алиас (см. BitrixUserGetParams) — для присваиваемости к Record. */
export type BitrixImMessagesParams = {
  DIALOG_ID: string;
  LIMIT?: number; // дефолт 50, максимум 100
  LAST_ID?: number;
  FIRST_ID?: number;
};

/** Сообщение IM (нижний регистр). `author_id=0` — системное. */
export interface BitrixImMessage {
  id: number;
  chat_id?: number;
  author_id: number;
  date: string; // ISO 8601
  text?: string;
  uuid?: string | null;
  params?: Record<string, unknown>;
}

/** `result` метода `im.dialog.messages.get`. */
export interface BitrixImMessagesResult {
  chat_id?: number;
  messages?: BitrixImMessage[];
  users?: unknown[];
  files?: unknown[];
}

// ─────────────────────────── crm.*.list ───────────────────────────────────

/** Общие параметры списочных CRM-методов (`crm.contact/company/deal.list`).
 *  `type`-алиас (см. BitrixUserGetParams) — для присваиваемости к Record. */
export type BitrixCrmListParams = {
  select?: string[];
  filter?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  start?: number;
};

/** Мультиполе CRM (EMAIL/PHONE приходят массивом таких объектов). */
export interface BitrixCrmMultifield {
  ID?: string;
  TYPE_ID?: string;
  VALUE_TYPE?: string;
  VALUE: string;
}

export interface BitrixCrmContact {
  ID: string;
  NAME?: string | null;
  LAST_NAME?: string | null;
  EMAIL?: BitrixCrmMultifield[] | string | null;
  PHONE?: BitrixCrmMultifield[] | string | null;
  [key: string]: unknown;
}

export interface BitrixCrmCompany {
  ID: string;
  TITLE?: string | null;
  [key: string]: unknown;
}

export interface BitrixCrmDeal {
  ID: string;
  TITLE?: string | null;
  STAGE_ID?: string | null;
  [key: string]: unknown;
}

/** Лид CRM (`crm.lead.list`). DATE_MODIFY доступен через индекс-сигнатуру. */
export interface BitrixCrmLead {
  ID: string;
  TITLE?: string | null;
  NAME?: string | null;
  LAST_NAME?: string | null;
  STATUS_ID?: string | null;
  [key: string]: unknown;
}
