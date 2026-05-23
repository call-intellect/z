import 'reflect-metadata';

/**
 * SBA γ-2 — `@ConciergeTool` decorator для регистрации REST-эндпоинтов
 * как whitelist tools для Concierge Agent.
 *
 * Использование (на методе controller'а):
 *
 *   @Post('meetings')
 *   @ConciergeTool({
 *     description: 'Создать новую встречу',
 *     undoableVia: 'cancelMeeting', // опц.: метод-rollback того же контроллера
 *   })
 *   async createMeeting(...) {}
 *
 * ServiceMapGeneratorService на startup сканирует все контроллеры и
 * собирает массив ToolSchema на основе:
 *   - Swagger metadata (@ApiOperation, @ApiBody, route path)
 *   - этого декоратора (description + undoableVia)
 *   - zod DTO-схемы из @Body (через @UsePipes(ZodValidationPipe))
 */
export interface ConciergeToolOptions {
  /** Человеко-читаемое описание для LLM (что делает tool). */
  description?: string;
  /**
   * Имя метода того же controller'а, который откатывает действие.
   * Если undefined → tool не undoable, concierge UI явно предупредит.
   *
   * Пример: для `createMeeting` → undoableVia: 'cancelMeeting'.
   */
  undoableVia?: string;
  /**
   * Минимальный RBAC ResourceType, который должен быть у tool. Concierge
   * прокидывает userId/tenantId в RBAC проверку существующего эндпоинта —
   * этот хинт нужен только для подсветки в UI («доступно ли это вам»).
   */
  rbacHint?: string;
  /**
   * `true` → tool мутирующий (POST/PATCH/PUT/DELETE). Concierge обязан
   * подтвердить через UI confirm перед исполнением, если undoableVia не
   * задан. По умолчанию вычисляется по HTTP-методу.
   */
  mutating?: boolean;
}

export const CONCIERGE_TOOL_METADATA_KEY = Symbol('CONCIERGE_TOOL');

/**
 * Декоратор-маркер. Метаданные сохраняем через reflect-metadata, чтобы
 * ServiceMapGeneratorService мог их прочитать через
 * `Reflect.getMetadata(CONCIERGE_TOOL_METADATA_KEY, controllerProto, methodName)`.
 */
export function ConciergeTool(
  options: ConciergeToolOptions = {},
): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    _descriptor: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      CONCIERGE_TOOL_METADATA_KEY,
      options,
      target,
      propertyKey,
    );
  };
}
