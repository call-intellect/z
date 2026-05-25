/**
 * Доменная модель EmailTemplate для Z-Admin (Фаза 5 редизайна).
 *
 * Контракт сервера: `backend/src/modules/admin/content/email-templates/...`
 * (префикс `/api/v1/admin/content/email-templates`).
 *
 * Шаблоны хранятся в `EmailTemplate` (БД). body — Handlebars plain text,
 * subject — отдельная строка, variables — JSON-словарь
 * `{ ключ: подсказка для редактора }`. category — enum-строка:
 * "transactional" | "marketing" | "system".
 */

export type EmailTemplateCategory =
  | 'transactional'
  | 'marketing'
  | 'system'
  | (string & {});

export const EMAIL_TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  transactional: 'Транзакционные',
  marketing: 'Маркетинг',
  system: 'Системные',
};

/** Подсказки переменных: `{ ключ → описание }`. Описание свободное. */
export type EmailTemplateVariablesMap = Record<string, string>;

export type EmailTemplateItemApi = {
  key: string;
  subject: string;
  body: string;
  htmlBody: string | null;
  /** В API произвольный JSON; на фронте приводим к Record<string,string>. */
  variables: unknown;
  category: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type EmailTemplateListApi = {
  items: EmailTemplateItemApi[];
};

export type EmailTemplateItemDomain = Omit<
  EmailTemplateItemApi,
  'updatedAt' | 'variables'
> & {
  variables: EmailTemplateVariablesMap;
  updatedAt: Date;
};

export type EmailTemplateListDomain = {
  items: EmailTemplateItemDomain[];
};

function asVariablesMap(v: unknown): EmailTemplateVariablesMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: EmailTemplateVariablesMap = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
    else if (val === null || val === undefined) continue;
    else out[k] = String(val);
  }
  return out;
}

export function emailTemplateItemFromApi(
  api: EmailTemplateItemApi,
): EmailTemplateItemDomain {
  return {
    key: api.key,
    subject: api.subject,
    body: api.body,
    htmlBody: api.htmlBody,
    variables: asVariablesMap(api.variables),
    category: api.category,
    updatedBy: api.updatedBy,
    updatedAt: new Date(api.updatedAt),
  };
}

export function emailTemplateListFromApi(
  api: EmailTemplateListApi,
): EmailTemplateListDomain {
  return { items: api.items.map(emailTemplateItemFromApi) };
}

export type UpdateEmailTemplateRequest = {
  subject?: string;
  body?: string;
  htmlBody?: string | null;
  variables?: EmailTemplateVariablesMap;
  category?: string;
};

export type CreateEmailTemplateRequest = {
  key: string;
  subject: string;
  body: string;
  htmlBody?: string | null;
  variables?: EmailTemplateVariablesMap;
  category: string;
};

/**
 * Очень компактный «Handlebars-light»-рендер для превью на фронте.
 *
 * Поддерживает:
 *   - `{{var}}` — подстановка строкового значения (HTML-escape).
 *   - `{{{var}}}` — без escape (опасно, но в плейн-тексте безопасно).
 *
 * Сложные конструкции (`#if`, `#each`) НЕ поддерживаются — для них нужен
 * полный handlebars-runtime. Если в шаблоне они есть, мы оставляем
 * выражение как есть, чтобы редактор видел «непокрытые» конструкции и не
 * ввёл оператора в заблуждение пустым рендером.
 *
 * Используется в `EmailPreviewPanel`. Дешевле, чем тянуть handlebars
 * (≈70 KB) в браузер.
 */
export function renderEmailPreview(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;

  // Сначала тройные скобки — без escape.
  result = result.replace(/\{\{\{\s*([\w.-]+)\s*\}\}\}/g, (_, key: string) => {
    const v = variables[key];
    return v ?? `{{{${key}}}}`;
  });

  // Двойные скобки — с escape (для plain text это не важно, но на всякий
  // случай экранируем минимальный набор HTML-сущностей, чтобы превью можно
  // было показать в `<pre>`-блоке без сюрпризов).
  result = result.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (full, key: string) => {
    // Не трогаем `{{#...}}` / `{{/...}}` — это блок-helper'ы.
    if (key.startsWith('#') || key.startsWith('/')) return full;
    const v = variables[key];
    if (v === undefined) return full;
    return escapeHtml(v);
  });

  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Извлекает имена переменных, упомянутых в шаблоне (`{{var}}` / `{{{var}}}`).
 * Helper-блоки (`{{#if}}` / `{{else}}` / `{{/each}}`) игнорируются.
 */
export function extractTemplateVariables(template: string): string[] {
  const seen = new Set<string>();
  const re = /\{\{\{?\s*([\w.-]+)\s*\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    const key = m[1];
    if (key.startsWith('#') || key.startsWith('/') || key === 'else') continue;
    seen.add(key);
  }
  return Array.from(seen);
}
