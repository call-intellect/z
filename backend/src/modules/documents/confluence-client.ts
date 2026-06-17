import { Injectable, Logger } from '@nestjs/common';

export interface ConfluencePage {
  title: string;
  text: string;
}

export interface ConfluenceFetchArgs {
  baseUrl: string;
  email: string;
  apiToken: string;
  spaceKey: string;
}

export class ConfluenceAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ConfluenceAuthError';
  }
}

export class ConfluenceFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ConfluenceFetchError';
  }
}

interface ContentListResponse {
  results?: Array<{
    title?: string;
    body?: { storage?: { value?: string } };
  }>;
  size?: number;
  limit?: number;
  start?: number;
}

const PAGE_LIMIT = 50;
const MAX_PAGES = 2000;

@Injectable()
export class ConfluenceClient {
  private readonly logger = new Logger(ConfluenceClient.name);

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
        throw new ConfluenceAuthError(
          `Confluence не нашёл пространство «${args.spaceKey}» (HTTP 404): проверьте адрес инстанса и ключ пространства`,
          res.status,
        );
      }
      if (!res.ok) {
        throw new ConfluenceFetchError(`Confluence вернул ошибку HTTP ${res.status}`, res.status);
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
