import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';

/**
 * Пайп валидации DTO через zod-схему. Используется адресно в контроллерах:
 *   `@Body(new ZodValidationPipe(CreateMeetingSchema)) dto: CreateMeetingDto`
 *
 * Глобальный `ZodValidationPipe` без схемы в Nest бессмыслен (схему
 * определяет конкретный DTO), поэтому глобально мы регистрируем no-op
 * вариант, а валидация подключается на уровне эндпоинтов.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Ошибка валидации входных данных',
          issues: this.formatIssues(result.error),
        },
      });
    }
    return result.data;
  }

  private formatIssues(error: ZodError): Array<{ path: string; message: string }> {
    return error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
  }
}

/**
 * Глобальный no-op пайп. Реальная валидация — через адресный
 * `new ZodValidationPipe(schema)` в `@Body()/@Query()`.
 */
@Injectable()
export class GlobalZodValidationPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown): unknown {
    return value;
  }
}
