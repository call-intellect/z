import { ConsoleLogger, Injectable, type LoggerService } from '@nestjs/common';

import { SystemLogCategory, type SystemLogLevel } from './log.constants';
import { LogService } from './log.service';

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

const SELF_CONTEXTS = new Set<string>([
  'DbLoggerBridge',
  'LogBufferService',
  'LogCleanupService',
  'LogSettingsService',
]);

const MAX_DETAILS_PARAMS = 10;

@Injectable()
export class DbLoggerBridge extends ConsoleLogger implements LoggerService {
  private readonly consoleDebugEnabled =
    (process.env.LOG_LEVEL ?? 'info').toLowerCase() === 'debug';

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
    if (this.consoleDebugEnabled) {
      super.debug(message as string, ...(rest as string[]));
    }
    this.forward('DEBUG', message, rest, false);
  }

  override verbose(message: unknown, ...rest: unknown[]): void {
    if (this.consoleDebugEnabled) {
      super.verbose(message as string, ...(rest as string[]));
    }
    this.forward('DEBUG', message, rest, false);
  }

  override fatal(message: unknown, ...rest: unknown[]): void {
    super.fatal(message as string, ...(rest as string[]));
    this.forward('FATAL', message, rest, true);
  }

  private forward(
    level: SystemLogLevel,
    message: unknown,
    rest: unknown[],
    withStack: boolean,
  ): void {
    try {
      const params = [...rest];

      let context: string | undefined;
      if (params.length > 0 && typeof params[params.length - 1] === 'string') {
        context = params.pop() as string;
      }

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
      } else {
        if (detailParams.length > 0 && typeof detailParams[detailParams.length - 1] === 'string') {
          text = detailParams.pop() as string;
          module = context;
        } else {
          text = context ?? '(no message)';
          module = undefined;
        }
        detailParams.unshift(message);
      }

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
    } catch {}
  }

  private collectDetails(params: unknown[]): unknown {
    const meaningful = params.filter((p) => p !== undefined && p !== null);
    if (meaningful.length === 0) return undefined;
    if (meaningful.length === 1) return meaningful[0];
    return { params: meaningful.slice(0, MAX_DETAILS_PARAMS) };
  }
}

function makeError(message: string, stack?: string): Error {
  const e = new Error(message);
  if (stack) e.stack = stack;
  return e;
}
