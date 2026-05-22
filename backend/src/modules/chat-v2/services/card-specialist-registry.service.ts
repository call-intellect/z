import { Injectable, Logger } from '@nestjs/common';

/**
 * SBA α-5 — Card Specialist Registry.
 *
 * Pluggable-реестр специалистов Слоя 3, которые умеют возвращать
 * релевантные карточки (`Card`, `Regulation`, `Decision`, ...) для query
 * chat-v2. Регистрация — push: каждый специалист в `onModuleInit` вызывает
 * `registry.register(name, handler)`.
 *
 * Это «вторая колонка» retrieval'а chat-v2:
 *   - первичный retrieval идёт по IdeaBlock через ChatV2RetrievalService
 *     (knowledge-core);
 *   - registry даёт второй слой — карточки, которые специалисты считают
 *     уместными (фильтр по overlap с candidateBlockIds или собственный
 *     embedding).
 *
 * На α-5 — пустой registry, готов принимать регистрации. Первая
 * регистрация — в α-6 (Card-специалист сам зовёт `register`).
 *
 * На α-5 chat-v2 НЕ использует выдачу registry в финальном prompt'е,
 * потому что ChatV2Service из knowledge-core ещё не принимает «extra
 * cards» — он работает поверх IdeaBlock-evidence. После α-6 специалисты
 * подключатся, а ChatV2Service эволюционирует, чтобы принимать карточки.
 * Сейчас registry — каркас, чтобы зависимости были стабильными.
 */

export interface CardSpecialistResult {
  /** Стабильный id карточки в БД специалиста. */
  id: string;
  /** 'regulation' | 'decision' | 'insight' | 'card' | … */
  type: string;
  title: string;
  /** Текстовое содержимое карточки (для prompt-сборки или UI-preview). */
  text: string;
  /** ID блоков, на которых построена карточка (для citations). */
  sourceBlockIds: string[];
  /** 0..1; chat-v2 объединит/отсортирует по убыванию. */
  confidence: number;
}

export interface CardSpecialistHandler {
  /**
   * Возвращает релевантные карточки специалиста для query.
   * Специалист может фильтровать по `candidateBlockIds` (overlap с
   * retrieval'ом chat-v2) или собственным embedding'ом.
   *
   * Контракт: метод НЕ должен бросать. Если специалист недоступен —
   * вернёт `[]` и залогирует.
   */
  getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]>;
}

export interface CardAggregateResult {
  /** Все карточки от всех специалистов, отсортированные по confidence DESC. */
  items: CardSpecialistResult[];
  /** Сколько специалистов фактически отработало. */
  specialistsRun: number;
  /** Имена упавших (вернувших исключение) специалистов — для логов. */
  specialistsFailed: string[];
}

@Injectable()
export class CardSpecialistRegistry {
  private readonly logger = new Logger(CardSpecialistRegistry.name);
  private readonly handlers = new Map<string, CardSpecialistHandler>();

  register(name: string, handler: CardSpecialistHandler): void {
    if (this.handlers.has(name)) {
      this.logger.warn(
        `CardSpecialistRegistry.register: специалист '${name}' уже зарегистрирован — перезаписываю`,
      );
    }
    this.handlers.set(name, handler);
    this.logger.log(
      `CardSpecialistRegistry: зарегистрирован '${name}' (всего: ${this.handlers.size})`,
    );
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  list(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Все специалисты дают свой top-K по релевантности; merge'им и
   * сортируем по confidence DESC. Лимит `totalLimit` обрезает результат.
   */
  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limitPerSpecialist: number;
    totalLimit: number;
  }): Promise<CardAggregateResult> {
    const results: CardSpecialistResult[] = [];
    const failed: string[] = [];
    let ran = 0;

    for (const [name, handler] of this.handlers.entries()) {
      try {
        const items = await handler.getCardsForQuery({
          tenantId: args.tenantId,
          query: args.query,
          candidateBlockIds: args.candidateBlockIds,
          limit: args.limitPerSpecialist,
        });
        results.push(...items);
        ran++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { specialist: name, err: message },
          'CardSpecialistRegistry: специалист упал — пропускаю',
        );
        failed.push(name);
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return {
      items: results.slice(0, args.totalLimit),
      specialistsRun: ran,
      specialistsFailed: failed,
    };
  }
}
