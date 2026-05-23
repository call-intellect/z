import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

/**
 * SBA γ-2 — ServiceMapGeneratorService.
 *
 * На startup собирает массив `ToolSchema` — whitelist REST tools, которые
 * Concierge Agent может вызывать через tool-use. На MVP — статический
 * список наиболее частых операций (meetings, cards, tasks, search, chat).
 * vNext — auto-scan через DiscoveryService NestJS + @ConciergeTool
 * декоратор + Swagger metadata.
 *
 * Каждый tool описывает:
 *   - name      — уникальное имя для LLM (snake_case);
 *   - description — что делает (для LLM-промпта);
 *   - method/path  — куда дёргать (если используем internal call);
 *   - parameters   — JSON Schema аргументов (для tool-use protocol);
 *   - undoableVia  — имя rollback-tool (если есть);
 *   - mutating     — нужен ли confirm; читается из HTTP-метода.
 */

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  parameters: ToolParameterSchema;
  /** Имя другого tool'а, который откатывает это действие. */
  undoableVia?: string;
  /** RBAC ResourceType, который нужен для tool'а (см. RbacService). */
  rbacResource?: string;
  /** Действие RBAC (`read`/`write`/`delete`). */
  rbacAction?: 'read' | 'write' | 'delete' | 'manage';
}

@Injectable()
export class ServiceMapGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(ServiceMapGeneratorService.name);
  private toolsCache: ToolSchema[] = [];

  onModuleInit(): void {
    this.toolsCache = this.buildStaticToolMap();
    this.logger.log(
      `ServiceMapGeneratorService: загружено ${this.toolsCache.length} whitelist tools`,
    );
  }

  /** Список tools, доступных Concierge Agent. */
  getTools(): ToolSchema[] {
    return [...this.toolsCache];
  }

  /** Найти tool по имени (для ToolRouterService). */
  findTool(name: string): ToolSchema | null {
    return this.toolsCache.find((t) => t.name === name) ?? null;
  }

  /**
   * Сериализованный JSON-фрагмент для system promptа LLM. Структура:
   *
   *   [
   *     { name, description, parameters: {...JSON Schema...} },
   *     ...
   *   ]
   */
  buildToolUsePromptFragment(): string {
    return JSON.stringify(
      this.toolsCache.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      null,
      2,
    );
  }

  // ──────────────────────────── private ────────────────────────────────

  /**
   * MVP-список tools. Каждый соответствует существующему REST-эндпоинту.
   * Дополняется через @ConciergeTool в vNext.
   */
  private buildStaticToolMap(): ToolSchema[] {
    return [
      {
        name: 'list_meetings',
        description:
          'Получить список встреч пользователя (последние 20). Используй для запросов «покажи встречи», «что у меня было сегодня».',
        method: 'GET',
        path: '/api/v1/meetings',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Сколько встреч вернуть (1..50).',
            },
          },
        },
        rbacResource: 'meeting',
        rbacAction: 'read',
      },
      {
        name: 'create_meeting',
        description:
          'Создать новую встречу с заданной темой (title) и типом (type ∈ standup|sales|interview|brainstorm|...). Возвращает URL комнаты.',
        method: 'POST',
        path: '/api/v1/meetings',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Тема встречи' },
            type: { type: 'string', description: 'Тип встречи' },
          },
          required: ['title', 'type'],
        },
        undoableVia: 'cancel_meeting',
        rbacResource: 'meeting',
        rbacAction: 'write',
      },
      {
        name: 'cancel_meeting',
        description: 'Отменить (мягко удалить) встречу по id.',
        method: 'POST',
        path: '/api/v1/meetings/:id/cancel',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Meeting ID' },
          },
          required: ['id'],
        },
        rbacResource: 'meeting',
        rbacAction: 'delete',
      },
      {
        name: 'search_knowledge',
        description:
          'Полнотекстовый поиск по карточкам, встречам, задачам, документам, отделам, должностям. Использовать для общих вопросов «найди X».',
        method: 'GET',
        path: '/api/v1/search',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Строка поиска' },
          },
          required: ['q'],
        },
        rbacResource: 'block',
        rbacAction: 'read',
      },
      {
        name: 'ask_chat_v2',
        description:
          'Задать развёрнутый вопрос AI-чату компании поверх IdeaBlock-графа (chat-v2). Возвращает ответ с цитатами. Использовать для смысловых вопросов «что мы решили по проекту X».',
        method: 'POST',
        path: '/api/v1/chat-v2/messages',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
          },
          required: ['question'],
        },
        rbacResource: 'chat_v2_conversation',
        rbacAction: 'write',
      },
      {
        name: 'list_tasks',
        description: 'Получить мои активные задачи (по умолчанию — top 20).',
        method: 'GET',
        path: '/api/v1/tasks',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
        },
        rbacResource: 'task',
        rbacAction: 'read',
      },
    ];
  }
}
