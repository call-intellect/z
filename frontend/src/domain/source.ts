export type SourceUiType = "bot" | "phone_call" | "email" | "web_form";

export const SOURCE_UI_TYPES: readonly SourceUiType[] = [
  "bot",
  "phone_call",
  "email",
  "web_form",
] as const;

export const SOURCE_TYPE_LABELS: Record<SourceUiType, string> = {
  bot: "Telegram-бот",
  phone_call: "Телефония (Mango)",
  email: "Электронная почта (IMAP)",
  web_form: "Текстовые заметки (web-form)",
};

export type SourceTypeApi =
  | "meeting"
  | "chat"
  | "phone_call"
  | "bot"
  | "email"
  | "web_form"
  | "external";

export type DataClass = "public" | "internal" | "sensitive" | "private";

export const DATA_CLASS_VALUES: readonly DataClass[] = [
  "public",
  "internal",
  "sensitive",
  "private",
] as const;

export const DATA_CLASS_LABELS: Record<DataClass, string> = {
  public: "Публичные",
  internal: "Внутренние",
  sensitive: "Чувствительные",
  private: "Личные",
};

export function dataClassBadgeVariant(
  c: DataClass,
): "secondary" | "success" | "warning" | "danger" {
  switch (c) {
    case "public":
      return "success";
    case "internal":
      return "secondary";
    case "sensitive":
      return "warning";
    case "private":
      return "danger";
  }
}

export const ENCRYPTED_MARKER = "<encrypted>";

export interface SourceApi {
  id: string;
  tenantId: string;
  type: SourceTypeApi;
  name: string;
  config: Record<string, unknown> | null;
  dataClass: DataClass;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  webhookUrl?: string;
  lastEventAt?: string | null;
}

export interface SourceListApi {
  items: SourceApi[];
  total: number;
}

export interface SourceTestResultApi {
  ok: boolean;
  details?: Record<string, unknown>;
  errorMessage?: string;
}

export interface SourceDomain {
  id: string;
  tenantId: string;
  type: SourceTypeApi;
  name: string;
  config: Record<string, unknown> | null;
  dataClass: DataClass;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  webhookUrl: string | null;
  lastEventAt: Date | null;
}

export function mapSourceDtoToDomain(dto: SourceApi): SourceDomain {
  return {
    id: dto.id,
    tenantId: dto.tenantId,
    type: dto.type,
    name: dto.name,
    config: dto.config,
    dataClass: dto.dataClass,
    isActive: dto.isActive,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    webhookUrl: dto.webhookUrl ?? null,
    lastEventAt: dto.lastEventAt ? new Date(dto.lastEventAt) : null,
  };
}

export function relativeTime(date: Date | null): string {
  if (!date) return "—";
  const ms = date.getTime();
  if (Number.isNaN(ms)) return "—";
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "только что";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} дн. назад`;
  return date.toLocaleDateString("ru", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export function parseLinesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseLinesToNumbers(value: string): number[] {
  return parseLinesToList(value)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n));
}

export function generateWebhookSecret(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  let s = "";
  const chars = "abcdef0123456789";
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

export function generateNonce(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
