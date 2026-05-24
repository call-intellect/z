import { Inject, Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { IdempotencyService } from './idempotency.service';

/**
 * Заголовок Idempotency-Key (case-insensitive). Express нормализует имена
 * в lower-case при доступе через `req.header()` — игнорируем регистр.
 */
const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Минимально допустимая длина ключа. Слишком короткие значения с большой
 * вероятностью — мусор/копипаст; обходим, чтобы не засорять Redis.
 */
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 128;

/**
 * IdempotencyMiddleware — общий перехватчик для tracker-эндпоинтов (POST
 * /api/v1/issues, /api/v1/issues/:id/comments, /api/v1/intake).
 *
 * Алгоритм:
 *   1. Если метод не POST или нет заголовка `Idempotency-Key` — пропускаем
 *      запрос без модификации.
 *   2. Берём tenantId: сначала из `X-Org-Id`, иначе из `req.user.tenantId`
 *      (если auth-guard уже отработал; в момент middleware обычно guard'ы
 *      ещё не запущены, поэтому надёжнее всего — заголовок).
 *   3. Делаем `GET` в Redis: если HIT — отдаём кэшированный ответ и НЕ
 *      пропускаем запрос дальше (handler не вызывается, БД не трогается).
 *   4. Иначе оборачиваем `res.json`/`res.send` так, чтобы захватить итоговый
 *      ответ, и пишем его в Redis (fire-and-forget).
 *
 * Контракт:
 *   - кэшируем только 2xx ответы. 4xx/5xx — клиент должен иметь возможность
 *     повторить с другим телом, кэширование ошибки приведёт к застреванию.
 *   - JSON-сериализация выполняется силами Express (`res.json` уже делает
 *     stringify); мы перехватываем тело ДО отправки.
 *
 * Не путать с `IdempotencyInterceptor` (Crossmark-only, пишет в Postgres).
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  constructor(
    @Inject(IdempotencyService) private readonly store: IdempotencyService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'POST') {
      next();
      return;
    }

    const rawKey = req.header(IDEMPOTENCY_HEADER);
    const key = this.normalizeKey(rawKey);
    if (!key) {
      next();
      return;
    }

    const tenantId = this.resolveTenantId(req);

    // 1. HIT: моментальный ответ из кэша, handler пропускаем.
    const cached = await this.store.getCached(key, tenantId);
    if (cached) {
      this.logger.debug(
        `Idempotency HIT key=${key} tenant=${tenantId ?? 'global'} status=${cached.status}`,
      );
      // Восстанавливаем headers, статус и тело.
      if (cached.headers) {
        for (const [name, value] of Object.entries(cached.headers)) {
          res.setHeader(name, value);
        }
      }
      // Помечаем replay для observability.
      res.setHeader('Idempotency-Replay', 'true');
      res.status(cached.status);
      // Тело уже JSON-сериализованный объект — отдаём через .json,
      // чтобы Content-Type выставился правильно.
      res.json(cached.body);
      return;
    }

    // 2. MISS: перехватываем тело ответа.
    this.wrapResponse(req, res, key, tenantId);
    next();
  }

  /**
   * Подменяет `res.json` / `res.send`, чтобы сохранить тело и статус ПОСЛЕ
   * того, как контроллер ответил. Не вмешиваемся в самó написание — только
   * шпионим.
   */
  private wrapResponse(
    _req: Request,
    res: Response,
    key: string,
    tenantId: string | null,
  ): void {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const captureAndStore = (body: unknown): void => {
      const status = res.statusCode;
      // Кэшируем только 2xx — клиенту нет смысла повторять идемпотентный POST,
      // на который вернулась 4xx/5xx.
      if (status < 200 || status >= 300) {
        return;
      }
      // fire-and-forget: не блокируем ответ клиенту.
      void this.store
        .setCached(key, tenantId, {
          status,
          body: this.normalizeBody(body),
        })
        .catch((err) => {
          this.logger.warn(
            `Не удалось сохранить Idempotency snapshot: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    };

    // res.json — стандартный путь NestJS-контроллеров.
    res.json = (body?: unknown): Response => {
      captureAndStore(body);
      return originalJson(body);
    };

    // res.send — на случай, если контроллер возвращает строку/Buffer.
    res.send = (body?: unknown): Response => {
      captureAndStore(body);
      return originalSend(body);
    };
  }

  /**
   * tenantId — приоритеты:
   *   1. Header `X-Org-Id` (стандартный путь, выставляет фронт перед каждым
   *      запросом, см. frontend api-client).
   *   2. `req.user.tenantId`, если auth уже отработал (в реальности
   *      middleware применяется до guard'ов; здесь — на всякий случай).
   * Если ничего нет — кэшируем в пространстве `global`.
   */
  private resolveTenantId(req: Request): string | null {
    const headerVal = req.header('x-org-id');
    if (headerVal && typeof headerVal === 'string' && headerVal.trim().length > 0) {
      return headerVal.trim();
    }
    const user = (req as unknown as { user?: { tenantId?: string } }).user;
    if (user?.tenantId && typeof user.tenantId === 'string') {
      return user.tenantId;
    }
    return null;
  }

  /**
   * Возвращает trimmed key, если он валиден (длина в [MIN..MAX], без
   * управляющих символов). Иначе — null (заголовок игнорируется).
   */
  private normalizeKey(raw: string | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) {
      return null;
    }
    // Запрещаем непечатные символы и пробелы внутри ключа.
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\s]/.test(trimmed)) return null;
    return trimmed;
  }

  /**
   * Гарантирует, что body сериализуется в JSON. Глубоко не клонируем —
   * Redis всё равно вернёт строку JSON.parse'нутую обратно.
   * Объекты-значения с круговыми ссылками отбрасываем (try/catch на сериализации
   * выполнится в IdempotencyService.setCached).
   */
  private normalizeBody(body: unknown): unknown {
    if (body === undefined) return null;
    return body;
  }
}
