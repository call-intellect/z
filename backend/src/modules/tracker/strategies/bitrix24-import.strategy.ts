import { Injectable, NotImplementedException } from '@nestjs/common';

import type {
  ImportResult,
  ImportStrategy,
  ImportStrategyArgs,
} from './import-strategy.interface';

/**
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — Битрикс24 импорт.
 *
 * Заглушка: реализация отложена в Phase 5 part 2 (отдельный sprint).
 * Worker сразу падает с NotImplemented, ImportLog'у выставляется
 * status='failed' с описательной ошибкой.
 *
 * DTO в контроллере уже принимает webhookUrl + selectedGroupIds, чтобы
 * frontend wizard мог отрендерить форму без блокеров.
 */
@Injectable()
export class Bitrix24ImportStrategy implements ImportStrategy {
  async run(_args: ImportStrategyArgs): Promise<ImportResult> {
    throw new NotImplementedException(
      'Bitrix24 import — реализация отложена в Phase 5 part 2',
    );
  }
}
