import { Injectable, Logger } from '@nestjs/common';

/**
 * `ConfluenceClient` (ТЗ-4 Ф9 — импорт из Confluence Cloud).
 *
 * Тонкий HTTP-клиент Confluence Cloud REST API v1. Тянет страницы одного
 * пространства (space) и отдаёт `[{ title, text }]` для batch-импорта в граф.
 *
 * Контракт API (verified через Context7, developer.atlassian.com, 2026-06-09):
 *   - Эндпоинт: `GET {baseUrl}/wiki/rest/api/content`
 *     `?spaceKey=<KEY>&type=page&expand=body.storage&limit=<n>&start=<offset>`.
 *   - Аутентификация: HTTP Basic — `Authorization: Basic base64(<email>:<apiToken>)`
 *     (email учётки Atlassian + API-токен, НЕ пароль).
 *   - Пагинация (v1): offset-based — параметры `limit` + `start` (0-indexed).
 *     Ответ: `{ results: Page[], size, start, limit }`. Идём дальше, пока
 *     `results.length === limit` (вернули полную страницу — возможно есть ещё).
 *   - Тело страницы: `result.body.storage.value` — storage-format (XHTML).
 *     Снимаем теги локальным `stripStorageHtml` (без новых зависимостей; тот же
 *     подход, что и `stripHtmlTags` парсера документов).
 *   - 401 / 403 → `ConfluenceAuthError` (неверный токен/email или нет доступа к
 *     пространству); вызывающая сторона помечает импорт `failed` с machine-кодом
 *     `confluence_auth_failed`.
 *
 * NB: клиент НИЧЕГО не хранит и не логирует токен. Токен живёт только в памяти
 * на время вызова. Шифрование/дешифрование — ответственность caller'а
 * (`DocumentImportService` ↔ `CryptoService`, токен в зашифрованном job-payload).
 */

/** Одна импортируемая страница Confluence: заголовок + плоский текст тела. */
export interface ConfluencePage {
  /** Заголовок страницы (становится `Document.name`). */
  title: string;
  /** Текст тела (storage-HTML, очищенный от тегов). */
  text: string;
}

/** Параметры подключения к одному пространству Confluence. */
export interface ConfluenceFetchArgs {
  /** База инстанса, например `https://acme.atlassian.net` (без `/wiki`). */
  baseUrl: string;
  /** Email учётки Atlassian (логин Basic-auth). */
  email: string;
  /** API-токен Atlassian (пароль Basic-auth). */
  apiToken: string;
  /** Ключ пространства, например `ENG`. */
  spaceKey: string;
}

/**
 * Ошибка аутентификации/доступа Confluence (HTTP 401/403). Caller маппит её в
 * machine-код `confluence_auth_failed` и помечает импорт `failed` — не «тихий
 * краш».
 */
export class ConfluenceAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ConfluenceAuthError';
  }
}

/** Прочие транзиентные/конфигурационные ошибки Confluence (не auth). */
export class ConfluenceFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ConfluenceFetchError';
  }
}

/** Минимальный размер shape ответа v1 `/content` (нужные поля). */
interface ContentListResponse {
  results?: Array<{
    title?: string;
    body?: { storage?: { value?: string } };
  }>;
  size?: number;
  limit?: number;
  start?: number;
}

/** Лимит страниц на один запрос v1 `/content` (Atlassian-дефолт 25, max ~100). */
const PAGE_LIMIT = 50;
/** Жёсткий потолок страниц за один импорт — защита от runaway-пагинации. */
const MAX_PAGES = 2000;

@Injectable()
export class ConfluenceClient {
  private readonly logger = new Logger(ConfluenceClient.name);

  /**
   * Тянет все страницы (`type=page`) пространства `spaceKey`, идя по offset-
   * пагинации, и возвращает `[{ title, text }]`. Тело каждой страницы
   * (`body.storage.value`) очищается от HTML-тегов.
   *
   * Бросает:
   *   - `ConfluenceAuthError` на 401/403 (неверный токен/email или нет прав).
   *   - `ConfluenceFetchError` на прочие не-2xx / сетевые ошибки.
   */
  async fetchSpacePages(args: ConfluenceFetchArgs): Promise<ConfluencePage[]> {
    const base = args.baseUrl.replace(/\/+$/, '');
    const authHeader =
      'Basic ' + Buffer.from(`${args.email}:${args.apiToken}`, 'utf8').toString('base64');

    const pages: ConfluencePage[] = [];
    let start = 0;
    for (let iter = 0; iter < MAX_PAGES / PAGE_LIMIT + 1; iter += 1) {
      const url =
        `${base}/wiki/rest/api/content` +
        `?spaceKey=${encodeURIComponent(args.spaceKey)}` +
        `&type=page&status=current&expand=body.storage` +
        `&limit=${PAGE_LIMIT}&start=${start}`;

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: authHeader, Accept: 'application/json' },
        });
      } catch (err) {
        throw new ConfluenceFetchError(
          `Не удалось подключиться к Confluence: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (res.status === 401 || res.status === 403) {
        throw new ConfluenceAuthError(
          `Confluence отклонил доступ (HTTP ${res.status}): проверьте email, API-токен и права на пространство «${args.spaceKey}»`,
          res.status,
        );
      }
      if (res.status === 404) {
        // Неверный baseUrl или несуществующий spaceKey — трактуем как auth/конфиг
        // проблему (то же поведение для пользователя: импорт failed).
        throw new ConfluenceAuthError(
          `Confluence не нашёл пространство «${args.spaceKey}» (HTTP 404): проверьте адрес инстанса и ключ пространства`,
          res.status,
        );
      }
      if (!res.ok) {
        throw new ConfluenceFetchError(
          `Confluence вернул ошибку HTTP ${res.status}`,
          res.status,
        );
      }

      let body: ContentListResponse;
      try {
        body = (await res.json()) as ContentListResponse;
      } catch (err) {
        throw new ConfluenceFetchError(
          `Не удалось разобрать ответ Confluence: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const results = body.results ?? [];
      for (const r of results) {
        const title = (r.title ?? '').trim() || 'Без названия';
        const html = r.body?.storage?.value ?? '';
        const text = stripStorageHtml(html);
        pages.push({ title, text });
      }

      // v1 offset-пагинация: вернули полную страницу (== limit) → возможно есть
      // ещё. Меньше limit (или пусто) → это последняя страница.
      if (results.length < PAGE_LIMIT) break;
      start += PAGE_LIMIT;
      if (pages.length >= MAX_PAGES) {
        this.logger.warn(
          { spaceKey: args.spaceKey, fetched: pages.length },
          'confluence.fetchSpacePages: достигнут потолок MAX_PAGES — обрезаем',
        );
        break;
      }
    }

    this.logger.log(
      { spaceKey: args.spaceKey, pages: pages.length },
      'confluence.fetchSpacePages: страницы получены',
    );
    return pages;
  }
}

/**
 * Снимает теги storage-format (XHTML) Confluence и декодирует базовые HTML-
 * сущности — то же, что `stripHtmlTags` парсера документов, но локально (без
 * импорта из ingest/parsers, чтобы не тянуть зависимость parser-модуля).
 * Дополнительно дропает CDATA-обёртки макросов и `<ac:.../>`-теги Confluence.
 */
function stripStorageHtml(html: string): string {
  return html
    .replace(/<!\[CDATA\[/g, ' ')
    .replace(/\]\]>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
