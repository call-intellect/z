import { ConsoleLogger, Injectable, type LoggerService } from '@nestjs/common';

import { SystemLogCategory, type SystemLogLevel } from './log.constants';
import { LogService } from './log.service';

/**
 * LoggingModule — мост Nest `Logger` → БД (`SystemLog`).
 *
 * Регистрируется через `app.useLogger(bridge)` в `main.ts`. Любой вызов
 * `new Logger(X).log/warn/error/debug(...)` по всему бэкенду:
 *   1) печатается в stdout как раньше (наследуем `ConsoleLogger`);
 *   2) форвардится в `LogService.write()` → буфер → БД.
 *
 * Контекст логгера (`new Logger(X.name)`) попадает в `module`; `pipeline`/
 * `traceId`/`userId`/... подмешиваются `LogService` из ALS-контекста. Это даёт
 * покрытие «всех аспектов» без правки сотен call-site'ов.
 *
 * Анти-петля: НЕ форвардим внутренние логгеры LoggingModule (иначе ошибка
 * flush'а буфера залогировалась бы рекурсивно) и фреймворковые логи Nest.
 * Запись best-effort — никогда не бросает (LogService уже глотает ошибки).
 *
 * См. plans/tz/2026-06-03-logging-pipelines-coverage.md §Ф1.
 */

/** Фреймворковые контексты Nest — шум, в БД не пишем. */
const FRAMEWORK_CONTEXTS = new Set<string>([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestFactory',
  'NestApplication',
  'WebSocketsController',
  'NestMicroservice',
  'GraphQLModule',
]);

/** Внутренние логгеры LoggingModule — пропускаем во избежание рекурсии. */
const SELF_CONTEXTS = new Set<string>([
  'DbLoggerBridge',
  'LogBufferService',
  'LogCleanupService',
  'LogSettingsService',
]);

const MAX_DETAILS_PARAMS = 10;

@Injectable()
export class DbLoggerBridge extends ConsoleLogger implements LoggerService {
  constructor(private readonly logs: LogService) {
    super();
  }

  override log(message: unknown, ...rest: unknown[]): void {
    super.log(message as string, ...(rest as string[]));
    this.forward('INFO', message, rest, false);
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(message as string, ...(rest as string[]));
    this.forward('WARN', message, rest, false);
  }

  override error(message: unknown, ...rest: unknown[]): void {
    super.error(message as string, ...(rest as string[]));
    this.forward('ERROR', message, rest, true);
  }

  override debug(message: unknown, ...rest: unknown[]): void {
    super.debug(message as string, ...(rest as string[]));
    this.forward('DEBUG', message, rest, false);
  }

  override verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(message as string, ...(rest as string[]));
    this.forward('DEBUG', message, rest, false);
  }

  override fatal(message: unknown, ...rest: unknown[]): void {
    super.fatal(message as string, ...(rest as string[]));
    this.forward('FATAL', message, rest, true);
  }

  /**
   * Разбирает аргументы Nest-логгера и пишет в БД.
   *
   * Поддерживает два стиля вызова:
   *   - Nest: `(message: string, ...params, context?: string)` — context = последний
   *     строковый аргумент (Nest всегда добавляет привязанный контекст последним).
   *   - pino-стиль (используется в части воркеров): `({ ...obj }, 'human message')` —
   *     message-объект становится `details`, а строковый хвост — текстом сообщения.
   */
  private forward(
    level: SystemLogLevel,
    message: unknown,
    rest: unknown[],
    withStack: boolean,
  ): void {
    try {
      const params = [...rest];

      // context = последний строковый аргумент (привязанный контекст логгера).
      let context: string | undefined;
      if (params.length > 0 && typeof params[params.length - 1] === 'string') {
        context = params.pop() as string;
      }

      // Для ошибок предпоследний строковый аргумент с переносом строк — стек.
      let stack: string | undefined;
      if (
        withStack &&
        params.length > 0 &&
        typeof params[params.length - 1] === 'string' &&
        (params[params.length - 1] as string).includes('\n')
      ) {
        stack = params.pop() as string;
      }

      let text: string;
      let module: string | undefined = context;
      const detailParams: unknown[] = params;

      if (typeof message === 'string') {
        text = message;
      } else if (message instanceof Error) {
        text = message.message || message.name;
        stack = stack ?? message.stack;
        // объект-ошибку не дублируем в details — она уйдёт в error*.
      } else {
        // pino-стиль: первый аргумент — объект-details.
        if (detailParams.length > 0 && typeof detailParams[detailParams.length - 1] === 'string') {
          // (obj, 'human msg', 'Context') — есть и текст, и контекст.
          text = detailParams.pop() as string;
          module = context;
        } else {
          // (obj, 'human msg') — строка, попавшая в context, и есть текст.
          text = context ?? '(no message)';
          module = undefined; // имя модуля возьмётся из ALS-контекста
        }
        detailParams.unshift(message);
      }

      // Шум/рекурсия — отбрасываем по имени контекста.
      if (module && (FRAMEWORK_CONTEXTS.has(module) || SELF_CONTEXTS.has(module))) {
        return;
      }

      const details = this.collectDetails(detailParams);

      this.logs.write({
        level,
        message: text,
        category: SystemLogCategory.SYSTEM,
        ...(module ? { module } : {}),
        ...(details !== undefined ? { details } : {}),
        ...(withStack && (stack || message instanceof Error)
          ? { error: message instanceof Error ? message : makeError(text, stack) }
          : {}),
      });
    } catch {
      // best-effort — лог не должен влиять на работу приложения.
    }
  }

  /** Собирает доп. параметры в details (объект, если их несколько). */
  private collectDetails(params: unknown[]): unknown {
    const meaningful = params.filter((p) => p !== undefined && p !== null);
    if (meaningful.length === 0) return undefined;
    if (meaningful.length === 1) return meaningful[0];
    return { params: meaningful.slice(0, MAX_DETAILS_PARAMS) };
  }
}

/** Синтетическая ошибка для переноса стека в LogService (если message — строка). */
function makeError(message: string, stack?: string): Error {
  const e = new Error(message);
  if (stack) e.stack = stack;
  return e;
}
