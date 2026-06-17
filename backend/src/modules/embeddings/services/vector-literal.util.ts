/**
 * Guard + сборка pgvector-литерала (`[v1,v2,...]`) для READ-пути поиска.
 *
 * Зачем: оператор pgvector `<=>` падает (а с ним — весь `/search` с 500),
 * если строка-литерал не той размерности, что колонка `vector(N)`, или
 * содержит `NaN`/`Infinity` (pgvector не парсит их и кидает ошибку в SQL).
 * При смене модели эмбеддинга (другая размерность) или битом векторе это
 * валит КАЖДЫЙ запрос пользователя.
 *
 * Контракт: проверяем (1) длину == ожидаемой размерности; (2) каждый элемент
 * `Number.isFinite`. На READ-пути предпочитаем graceful degrade — возвращаем
 * `null` (caller продолжает без cosine, отдаёт BM25/пустой recall), а не throw,
 * чтобы конечный `/search` не отвечал 500.
 */
export interface VectorLiteralResult {
  /** Готовый литерал `[..]` для подстановки перед `::vector(N)`, либо null если вектор отвергнут. */
  literal: string | null;
  /** Причина отказа (для WARN-лога). null когда literal валиден. */
  rejectReason: 'wrong_dimension' | 'non_finite' | 'empty' | null;
}

/**
 * Построить безопасный pgvector-литерал.
 *
 * @param vec  кандидат-вектор (например результат embedQuery).
 * @param expectedDim ожидаемая размерность колонки (обычно EMBEDDING_DIMENSIONS=1536).
 */
export function buildVectorLiteral(
  vec: number[] | null | undefined,
  expectedDim: number,
): VectorLiteralResult {
  if (!vec || vec.length === 0) {
    return { literal: null, rejectReason: 'empty' };
  }
  if (vec.length !== expectedDim) {
    return { literal: null, rejectReason: 'wrong_dimension' };
  }
  for (let i = 0; i < vec.length; i++) {
    if (!Number.isFinite(vec[i])) {
      return { literal: null, rejectReason: 'non_finite' };
    }
  }
  return { literal: `[${vec.join(',')}]`, rejectReason: null };
}
