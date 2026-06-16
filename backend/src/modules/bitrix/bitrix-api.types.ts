export type BitrixUserGetParams = {
  start?: number;
  FILTER?: Record<string, unknown>;
  SORT?: string;
  ORDER?: 'ASC' | 'DESC';
  ADMIN_MODE?: boolean;
};

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

export interface BitrixImRecentItem {
  id: string;
  type: 'user' | 'chat' | 'openline' | string;
  title?: string;
  chat_id?: number;
  last_id?: number;
  date_update?: string;
  date_last_activity?: string;
  message?: BitrixImRecentLastMessage;
  [key: string]: unknown;
}

export type BitrixImMessagesParams = {
  DIALOG_ID: string;
  LIMIT?: number;
  LAST_ID?: number;
  FIRST_ID?: number;
};

export interface BitrixImMessage {
  id: number;
  chat_id?: number;
  author_id: number;
  date: string;
  text?: string;
  uuid?: string | null;
  params?: Record<string, unknown>;
}

export interface BitrixImMessagesResult {
  chat_id?: number;
  messages?: BitrixImMessage[];
  users?: unknown[];
  files?: unknown[];
}

export type BitrixCrmListParams = {
  select?: string[];
  filter?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  start?: number;
};

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

export interface BitrixCrmLead {
  ID: string;
  TITLE?: string | null;
  NAME?: string | null;
  LAST_NAME?: string | null;
  STATUS_ID?: string | null;
  [key: string]: unknown;
}
