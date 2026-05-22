import { describe, expect, it } from 'vitest';

/**
 * Тесты для EntityResolutionService (Фаза 0b §8).
 *
 * Skeleton — реальные ассерты появятся в Фазе 0b.4 на pgvector-стенде.
 *
 * TODO (Фаза 0b.4):
 *   - resolveRoleByHint: точное совпадение vs fuzzy vs неоднозначность.
 *   - resolvePersonByHint: то же.
 *   - resolveTypedEntity: точное совпадение → matchKind='exact'.
 *   - resolveTypedEntity: pg_trgm недоступно → matchKind='none' (graceful).
 *   - resolveTypedEntity: pg_trgm cosine match → matchKind='cosine'.
 *   - linkPersonEntity / linkEntityPerson: двусторонняя линковка по точному совпадению.
 *   - LLM-arbiter в коридоре 0.78..0.92 — TODO (Фаза γ).
 */
describe.skip('EntityResolutionService (Фаза 0b)', () => {
  describe('resolveRoleByHint', () => {
    it('точное совпадение по имени должности', () => {
      expect(true).toBe(true);
    });

    it('fuzzy: подсказка содержит часть имени должности', () => {
      expect(true).toBe(true);
    });

    it('неоднозначность (>1 кандидата) → null', () => {
      expect(true).toBe(true);
    });
  });

  describe('resolveTypedEntity', () => {
    it('точное совпадение нормализованного имени → matchKind=exact', () => {
      expect(true).toBe(true);
    });

    it('pg_trgm недоступен → graceful fallback в matchKind=none', () => {
      expect(true).toBe(true);
    });

    it('LLM-arbiter в коридоре 0.78..0.92 — TODO (skipped)', () => {
      expect(true).toBe(true);
    });
  });

  describe('Person ↔ Entity линковка', () => {
    it('linkPersonEntity: Person.entityId заполняется при точном совпадении', () => {
      expect(true).toBe(true);
    });

    it('linkEntityPerson: обратная линковка с новым Entity{type=person}', () => {
      expect(true).toBe(true);
    });

    it('идемпотентность: повторный вызов — no-op', () => {
      expect(true).toBe(true);
    });
  });
});
