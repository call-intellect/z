import { Injectable, Logger } from '@nestjs/common';

export interface CardSpecialistResult {
  id: string;
  type: string;
  title: string;
  text: string;
  sourceBlockIds: string[];
  confidence: number;
}

export interface CardSpecialistHandler {
  getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]>;
}

export interface CardAggregateResult {
  items: CardSpecialistResult[];
  specialistsRun: number;
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
