import { describe, expect, it } from 'vitest';

/**
 * Тесты для BlockExtractionService v2 (Фаза 0b §5-§6).
 *
 * Skeleton — реальные ассерты добавятся, когда появится тестовый stand
 * для LLM (мок LlmRouterService.call с заранее подготовленным JSON-ответом).
 * Текущая структура — гарантия, что покрытие новых сценариев осталось в
 * todo-листе и не было забыто.
 *
 * TODO (Фаза 0b.3):
 *   - Извлечение типизированных сущностей группы Б.
 *   - Фильтр confidence < EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE.
 *   - Глобализация sourceBlockIndex через windows.
 *   - Парсинг role_relevant / roleHint.
 *   - Mission/Vision/Strategy всегда null.
 */
describe.skip('BlockExtractionService (Фаза 0b)', () => {
  it('извлекает блоки + типизированные сущности из одного JSON-ответа LLM', () => {
    expect(true).toBe(true);
  });

  it('фильтрует типизированные сущности с confidence < порога', () => {
    expect(true).toBe(true);
  });

  it('глобализует sourceBlockIndex через окна сегментов', () => {
    expect(true).toBe(true);
  });

  it('заполняет role_relevant=true только при наличии roleHint', () => {
    expect(true).toBe(true);
  });

  it('возвращает mission/vision/strategy = null (top-level отключено)', () => {
    expect(true).toBe(true);
  });
});
