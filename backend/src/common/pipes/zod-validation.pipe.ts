import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';

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

@Injectable()
export class GlobalZodValidationPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown): unknown {
    return value;
  }
}
