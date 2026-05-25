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
      {
        name: 'create_event',
        description:
          'Создать событие календаря (встреча, созвон, личная встреча или блок времени). Используй для запросов «запиши встречу с N на 3-е», «забронируй мне время в среду с 14 до 16», «созвон с клиентом завтра в 15:00». Параметр kind ∈ meeting|call|offline_meeting|personal_block|deadline. Если kind=meeting (онлайн-видео) — автоматически создастся LiveKit-комната.',
        method: 'POST',
        path: '/api/v1/events',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Название события' },
            startAt: {
              type: 'string',
              description:
                'ISO-8601 datetime начала (например, 2026-06-03T15:00:00+03:00)',
            },
            endAt: {
              type: 'string',
              description:
                'ISO-8601 datetime конца. Опц. — если не задан, MVP считает длительность 60 мин для meeting/call, 30 мин для personal_block.',
            },
            kind: {
              type: 'string',
              description:
                'Тип события: meeting|call|offline_meeting|personal_block|deadline (default meeting)',
            },
            visibility: {
              type: 'string',
              description:
                'company|team|personal (default company). personal не индексируется в графе.',
            },
            location: {
              type: 'string',
              description: 'Место (физ. адрес или ссылка). Опц.',
            },
            description: {
              type: 'string',
              description: 'Описание / повестка. Опц.',
            },
            participants: {
              type: 'array',
              description:
                'Массив объектов {userId} или {personId} с опц. role (organizer|required|optional).',
            },
          },
          required: ['title', 'startAt'],
        },
        undoableVia: 'delete_event',
        rbacResource: 'event_card',
        rbacAction: 'write',
      },
      {
        name: 'list_my_events',
        description:
          'Получить мои события календаря в диапазоне дат. Микшируется с задачами трекера: возвращает массив items, каждый — {type: "event", event} или {type: "issue", issue}. Используй для «какие у меня встречи сегодня», «что у меня запланировано на этой неделе», «покажи мой завтрашний день».',
        method: 'GET',
        path: '/api/v1/me/calendar',
        parameters: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description:
                'ISO-8601 datetime нижней границы. Default — сегодня 00:00 локального времени.',
            },
            to: {
              type: 'string',
              description:
                'ISO-8601 datetime верхней границы. Default — завтра 00:00.',
            },
          },
        },
        rbacResource: 'event_card',
        rbacAction: 'read',
      },
      {
        name: 'list_user_events',
        description:
          'Получить события и задачи другого пользователя по userId. Требует прав manager+ или быть участником события. Личные блоки (visibility=personal) другого пользователя возвращаются как "Занято" без деталей. Используй для «что у Васи на этой неделе», «свободен ли Петя завтра».',
        method: 'GET',
        path: '/api/v1/users/:userId/calendar',
        parameters: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'ID пользователя (User.id).',
            },
            from: {
              type: 'string',
              description: 'ISO-8601 нижняя граница.',
            },
            to: {
              type: 'string',
              description: 'ISO-8601 верхняя граница.',
            },
          },
          required: ['userId'],
        },
        rbacResource: 'event_card',
        rbacAction: 'read',
      },
      {
        name: 'find_free_slot',
        description:
          'Найти ближайший общий свободный слот заданной длительности среди участников. Учитывает события каждого участника и его задачи трекера (с estimateMinutes или дефолтом 30 мин). По умолчанию ищет в рабочее время (Пн-Пт 9:00-18:00 timezone организатора, который = первый user в списке). Используй для «найди время на этой неделе для созвона с Васей на час», «когда мы можем встретиться втроём на 30 минут».',
        method: 'POST',
        path: '/api/v1/events/find-free-slot',
        parameters: {
          type: 'object',
          properties: {
            participantUserIds: {
              type: 'array',
              description: 'Массив User.id участников (включая инициатора).',
            },
            durationMin: {
              type: 'number',
              description: 'Длительность нужного слота в минутах (15..480).',
            },
            withinDays: {
              type: 'number',
              description:
                'В каком горизонте искать (1..30 дней). Default 7.',
            },
            workingHoursOnly: {
              type: 'boolean',
              description:
                'Только в рабочее время Пн-Пт 9-18. Default true.',
            },
          },
          required: ['participantUserIds', 'durationMin'],
        },
        rbacResource: 'event_card',
        rbacAction: 'read',
      },
      {
        name: 'delete_event',
        description:
          'Отменить событие по id (мягкое удаление, status=cancelled). Используй для «отмени встречу с N», «удали событие в среду».',
        method: 'DELETE',
        path: '/api/v1/events/:id',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Event.id' },
          },
          required: ['id'],
        },
        rbacResource: 'event_card',
        rbacAction: 'delete',
      },
      // ───────── Clones=Roles Фаза 6 — ролевые клоны ─────────
      // Whitelist'им только ролевой клон и список ролевых клонов. Person-scope
      // `ask_my_clone` намеренно ОТСУТСТВУЕТ (ребренд 2026-05-25): клоны
      // привязаны к должностям, а не к людям.
      {
        name: 'ask_role_clone',
        description:
          'Спросить клон должности — отвечает от лица роли с учётом опыта текущего носителя. Используй для «спроси клон Маркетолога про каналы продвижения», «что бы сказал клон CFO про этот контракт».',
        method: 'POST',
        path: '/api/v1/clones/roles/:roleId/ask',
        parameters: {
          type: 'object',
          properties: {
            roleId: {
              type: 'string',
              description: 'Role.id — id должности, у клона которой спрашиваем.',
            },
            question: {
              type: 'string',
              description: 'Вопрос пользователя в свободной форме (3..2000 символов).',
            },
          },
          required: ['roleId', 'question'],
        },
        rbacResource: 'role',
        rbacAction: 'read',
      },
      {
        name: 'list_clones',
        description:
          'Получить список текущих ролевых клонов компании. Используй для «какие у нас есть клоны должностей», «покажи всех клонов», «есть ли клон Маркетолога».',
        method: 'GET',
        path: '/api/v1/clones',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description:
                'Фильтр по статусу клона: active|superseded. Default active.',
            },
            q: {
              type: 'string',
              description: 'Поиск подстрокой по названию должности (опц.).',
            },
          },
        },
        rbacResource: 'role',
        rbacAction: 'read',
      },
    ];
  }
}
