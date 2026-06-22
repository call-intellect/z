import { Inject, Injectable, Logger } from '@nestjs/common';

import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';

export interface ProactiveCraftInput {
  tenantId: string;
  userId: string;
  ruleType: string;
  severity: 'low' | 'medium' | 'high';
  facts: Record<string, unknown>;
}

export interface ProactiveCraftOutput {
  title: string;
  body: string;
  fromLlm: boolean;
}

@Injectable()
export class ProactiveMessageCraftService {
  private readonly logger = new Logger(ProactiveMessageCraftService.name);

  constructor(@Inject(LlmRouterService) private readonly llm: LlmRouterService) {}

  async craft(input: ProactiveCraftInput): Promise<ProactiveCraftOutput> {
    const systemPrompt = [
      'Ты — внутренний AI-помощник «Кора», который замечает вещи в графе компании и мягко подсвечивает их.',
      'Стиль: дружелюбный, короткий, без алармизма. Не используй «СРОЧНО», «АЛЕРТ», «!!!».',
      'Думай как заботливый коллега, который заглянул на минуту: «Заметил X — может, посмотришь?».',
      'Ответ — строго JSON: { "title": string (≤ 80 symbols), "body": string (≤ 280 symbols) }.',
      'Без markdown, без вложений, без эмодзи. Только русский язык.',
    ].join(' ');

    const userMessage = [
      `Правило: ${input.ruleType}`,
      `Серьёзность: ${input.severity}`,
      `Факты: ${JSON.stringify(input.facts).slice(0, 1_500)}`,
      'Сформулируй короткое уведомление (title + body) по образцу:',
      '{ "title": "Заметил решение без owner\'а", "body": "Решение «X» висит без ответственного 5 дней. Назначишь?" }',
      'Верни только JSON, без префиксов и пояснений.',
    ].join('\n');

    try {
      const result = await this.llm.call({
        taskType: 'proactive-message-craft',
        systemPrompt,
        userMessage,
        tenantId: input.tenantId,
        userId: input.userId,
        responseFormat: { type: 'json_object' },
        maxTokens: 400,
        dataClass: 'internal',
      });
      const parsed = this.tryParse(result);
      if (parsed) {
        return { ...parsed, fromLlm: true };
      }
      this.logger.warn(
        { ruleType: input.ruleType },
        'proactive-message-craft: невалидный JSON от LLM, fallback на шаблон',
      );
    } catch (err) {
      this.logger.warn(
        {
          ruleType: input.ruleType,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive-message-craft: LLM-вызов упал, fallback на шаблон',
      );
    }
    return { ...this.fallbackTextByRule(input), fromLlm: false };
  }

  private tryParse(res: LlmCallResult): { title: string; body: string } | null {
    try {
      const obj = JSON.parse(res.text);
      if (
        obj &&
        typeof obj === 'object' &&
        typeof obj.title === 'string' &&
        typeof obj.body === 'string' &&
        obj.title.trim().length > 0 &&
        obj.body.trim().length > 0
      ) {
        return {
          title: String(obj.title).trim().slice(0, 200),
          body: String(obj.body).trim().slice(0, 4_000),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private fallbackTextByRule(input: ProactiveCraftInput): {
    title: string;
    body: string;
  } {
    const facts = input.facts;
    const name = typeof facts.name === 'string' ? String(facts.name).slice(0, 80) : 'элемент';
    switch (input.ruleType) {
      case 'decision_no_owner':
        return {
          title: 'Решение без ответственного',
          body: `Решение «${name}» висит без owner'а уже несколько дней. Назначишь ответственного?`,
        };
      case 'insight_no_mitigation':
        return {
          title: 'Сигнал без плана действий',
          body: `Сигнал «${name}» повторяется, а плана реагирования пока нет. Зафиксируем шаги?`,
        };
      case 'experiment_running_too_long':
        return {
          title: 'Эксперимент засиделся',
          body: `Эксперимент «${name}» в статусе running уже долго и без результата. Подвести итог?`,
        };
      case 'process_stale_review':
        return {
          title: 'Процесс давно не редактировался',
          body: `Процесс «${name}» не обновлялся ≥ 90 дней. Загляни — всё ли актуально?`,
        };
      case 'role_low_completeness':
        return {
          title: 'Роль с пробелами',
          body: `На роль «${name}» завязано много людей, но описание неполное. Дозаполним?`,
        };
      case 'department_no_domain':
        return {
          title: 'Отдел без функциональной области',
          body: `Отдел «${name}» не связан ни с одним FunctionalDomain. Привяжем?`,
        };
      case 'insights_siloed_in_domain':
        return {
          title: 'Сигналы внутри одной области не связаны',
          body: `В области «${name}» несколько insight'ов не ссылаются друг на друга. Стоит сшить.`,
        };
      case 'plan_item_overdue': {
        const planItems = Array.isArray(facts.planItems)
          ? facts.planItems.filter((t): t is string => typeof t === 'string').slice(0, 3)
          : [];
        if (planItems.length > 0) {
          return {
            title: 'Обещал на сегодня — ещё не закрыто',
            body: `На сегодня в плане: ${planItems.join('; ')}. Вечер близко — отметишь, что сделано?`,
          };
        }
        return {
          title: 'Обещал на сегодня — ещё не закрыто',
          body: `«${name}» пока без отметки о завершении. Вечер близко — отметишь, что сделано?`,
        };
      }
      default:
        return {
          title: 'Кора заметила кое-что',
          body: `Заметил «${name}». Зайди и посмотри, пожалуйста.`,
        };
    }
  }
}
