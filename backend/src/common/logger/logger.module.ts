import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';

/**
 * Wrapper над `nestjs-pino`. Конфигурация:
 *   - prod: json, level из `LOG_LEVEL`.
 *   - dev: `pino-pretty` — читаемые цветные логи.
 *   - `genReqId` использует `req.id` поставленный RequestIdMiddleware.
 *   - `customProps`    — добавляет `requestId` в каждую запись.
 *   - `serializers.req`— минимальная сериализация запроса (без body).
 *
 * Конфиг читается напрямую из `process.env`, потому что Logger должен
 * подняться раньше всех остальных провайдеров — до того как полная DI-цепь
 * (ConfigModule → TypedConfigService) разрешена.
 */
const isDevelopment = (process.env['NODE_ENV'] ?? 'development') !== 'production';
const logLevel = process.env['LOG_LEVEL'] ?? 'info';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: logLevel,
        autoLogging: true,
        genReqId: (req: IncomingMessage): string => {
          const id = (req as IncomingMessage & { id?: string }).id;
          return id ?? '';
        },
        customProps: (req: IncomingMessage) => ({
          requestId: (req as IncomingMessage & { id?: string }).id,
        }),
        serializers: {
          req: (req: IncomingMessage & { id?: string; method?: string; url?: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
        },
        transport: isDevelopment
          ? {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                colorize: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
