import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { LlmTool } from '../../ai/services/llm.types';

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
  undoableVia?: string;
  readOnly?: boolean;
  rbacResource?: string;
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

  getTools(): ToolSchema[] {
    return [...this.toolsCache];
  }

  findTool(name: string): ToolSchema | null {
    return this.toolsCache.find((t) => t.name === name) ?? null;
  }

  buildToolUsePromptFragment(names?: string[]): string {
    return JSON.stringify(
      this.filterTools(names).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      null,
      2,
    );
  }

  toLlmTools(names?: string[]): LlmTool[] {
    return this.filterTools(names).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: t.parameters.properties,
        ...(t.parameters.required ? { required: t.parameters.required } : {}),
      },
    }));
  }

  private filterTools(names?: string[]): ToolSchema[] {
    if (!names) return this.toolsCache;
    const allow = new Set(names);
    return this.toolsCache.filter((t) => allow.has(t.name));
  }

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
          'Используй для создания новой видеовстречи Коры по теме (title) и типу (type ∈ standup|sales|interview|brainstorm|...). Возвращает ссылку на комнату. Для записи события в календарь (с датой/временем) используй create_event.',
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
        description:
          'Используй для отмены встречи Коры по её идентификатору. Откатывает create_meeting.',
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
        name: 'ask_chat_v2',
        description:
          'Используй для смыслового ВОПРОСА к памяти компании: «что мы решили / обсуждали по проекту X», «почему так сделали», «кто за что отвечает». Отвечает из графа знаний компании с ссылками на источники. Его ответ отдавай пользователю как есть, не переписывай.',
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
        readOnly: true,
      },
      {
        name: 'create_task',
        description:
          'Используй для постановки задачи СЕБЕ в трекер (в проект «Входящие»). Когда сотрудник просит поставить/создать задачу/дело/напоминание. Перед постановкой убедись, что ясны суть и (если нужно) срок.',
        method: 'POST',
        path: '/api/v1/me/tasks',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Краткая суть задачи (что нужно сделать).',
            },
            description: {
              type: 'string',
              description: 'Подробности задачи. Опц.',
            },
            dueDate: {
              type: 'string',
              description: 'Срок в формате ISO-8601 (например, 2026-06-20). Опц.',
            },
          },
          required: ['title'],
        },
        rbacResource: 'issue',
        rbacAction: 'write',
      },
      {
        name: 'search_tasks',
        description:
          'Используй для показа/поиска МОИХ задач в трекере (мои открытые дела, задачи на мне). Возвращает задачи с идентификаторами.',
        method: 'GET',
        path: '/api/v1/me/inbox',
        parameters: {
          type: 'object',
          properties: {
            cursor: { type: 'string', description: 'Курсор пагинации. Опц.' },
            limit: { type: 'number', description: 'Сколько задач вернуть. Опц.' },
          },
        },
        rbacResource: 'issue',
        rbacAction: 'read',
        readOnly: true,
      },
      {
        name: 'ingest_note',
        description:
          'Используй, когда сотрудник ДЕЛИТСЯ мыслью/идеей/наблюдением/фактом о клиенте или проекте (НЕ вопрос и НЕ команда) — занеси это в память компании. После — коротко подтверди «записал в память».',
        method: 'POST',
        path: '/api/v1/me/notifications/free-note',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Текст заметки/идеи/наблюдения дословно — то, чем поделился сотрудник.',
            },
          },
          required: ['text'],
        },
        readOnly: true,
      },
      {
        name: 'list_tasks',
        description:
          'Используй для показа действий-задач, извлечённых ИЗ ВСТРЕЧ (поручения и пункты, которые AI достал из расшифровки встречи). Это НЕ задачи трекера — для моих задач в трекере используй search_tasks.',
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
              description: 'ISO-8601 datetime начала (например, 2026-06-03T15:00:00+03:00)',
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
              description: 'ISO-8601 datetime верхней границы. Default — завтра 00:00.',
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
              description: 'В каком горизонте искать (1..30 дней). Default 7.',
            },
            workingHoursOnly: {
              type: 'boolean',
              description: 'Только в рабочее время Пн-Пт 9-18. Default true.',
            },
          },
          required: ['participantUserIds', 'durationMin'],
        },
        rbacResource: 'event_card',
        rbacAction: 'read',
        readOnly: true,
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
              description: 'Фильтр по статусу клона: active|superseded. Default active.',
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
      {
        name: 'get_person_pulse',
        description:
          'Получить карточку сотрудника (Pulse): mood, обещания, риск-сигналы, AI Resume. Используй для запросов «что с Иваном», «как дела у Ани».',
        method: 'GET',
        path: '/api/v1/persons/:personId/pulse',
        parameters: {
          type: 'object',
          properties: {
            personId: {
              type: 'string',
              description: 'ID сотрудника (Person.id, не User.id).',
            },
          },
          required: ['personId'],
        },
        rbacResource: 'person',
        rbacAction: 'read',
      },
      {
        name: 'list_overdue_promises',
        description:
          'Получить открытые и просроченные обещания компании за окно дней (с именами авторов и получателей). Используй для «какие обещания просрочены», «кто что не сделал».',
        method: 'GET',
        path: '/api/v1/dashboard/operations/open-commitments',
        parameters: {
          type: 'object',
          properties: {
            days: {
              type: 'number',
              description: 'Окно в днях (1..180). По умолчанию 14.',
            },
            limit: {
              type: 'number',
              description: 'Сколько обещаний вернуть (1..500). По умолчанию 100.',
            },
          },
        },
        rbacResource: 'dashboard_operations',
        rbacAction: 'read',
      },
      {
        name: 'get_sprint_status',
        description:
          'Получить текущий статус спринта (Cycle): метрики, помощник, подсказки. Используй для «как идёт спринт X», «что в спринте».',
        method: 'GET',
        path: '/api/v1/cycles/:cycleId/dashboard',
        parameters: {
          type: 'object',
          properties: {
            cycleId: {
              type: 'string',
              description: 'ID цикла (Cycle.id).',
            },
          },
          required: ['cycleId'],
        },
        rbacResource: 'cycle',
        rbacAction: 'read',
      },
      {
        name: 'get_team_health',
        description:
          'Получить агрегат здоровья команды: sentiment, обещания, конфликты по отделам. Используй для «какая команда просела», «здоровье команд».',
        method: 'GET',
        path: '/api/v1/dashboard/team-health',
        parameters: {
          type: 'object',
          properties: {
            departmentId: {
              type: 'string',
              description: 'Опц. ID отдела, иначе все.',
            },
          },
        },
        rbacResource: 'dashboard_operations',
        rbacAction: 'read',
      },
      {
        name: 'infer_table_schema',
        description:
          'Предложить схему новой таблицы по описанию пользователя (превью, без создания). Используй для «создай таблицу клиентов с контактами», «нужна таблица учёта оборудования». Возвращает предлагаемую структуру колонок — пользователь подтверждает создание отдельно.',
        method: 'POST',
        path: '/api/v1/tables/infer-schema',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Описание желаемой таблицы в свободной форме (3..2000 символов).',
            },
          },
          required: ['prompt'],
        },
        rbacResource: 'table',
        rbacAction: 'write',
      },
      {
        name: 'list_ignored_probe_questions',
        description:
          'Список probe-вопросов AI с status=expired — кто игнорирует уточнения. Используй для «кто не отвечает на вопросы AI», «игнорируемые вопросы».',
        method: 'GET',
        path: '/api/v1/feed/probe_question',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Должно быть expired.',
            },
            teamId: {
              type: 'string',
              description: 'Опц. ID команды.',
            },
            viewedUserId: {
              type: 'string',
              description: 'Опц. User.id — чьи вопросы.',
            },
            limit: {
              type: 'number',
              description: 'Default 20.',
            },
          },
        },
        rbacResource: 'activity_feed_item',
        rbacAction: 'read',
      },
    ];
  }
}
