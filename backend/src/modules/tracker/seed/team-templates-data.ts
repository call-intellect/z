/**
 * Wave 3 / Tracker Phase 4 — данные для 10 системных + 5 опциональных
 * шаблонов команд (TeamTemplate).
 *
 * Используется:
 *   - `backend/scripts/seed-team-templates.ts` — standalone seed.
 *   - `ProjectsFromTemplateService.createFromTemplate()` — загружает шаблон
 *     по slug (сначала per-tenant, потом fallback к системному tenantId=null).
 *
 * Все имена/описания/ответственности — на русском (см. skill
 * `feedback_admin_ui_russian_only`). Английские слова допустимы только как
 * технические маркеры (slug, category, stateKey категории).
 */

export type TeamTemplateStateCategory =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'cancelled';

export interface TeamTemplateRole {
  /** Машинный ключ (`sales_manager`, `tech_lead`). */
  key: string;
  /** Человекочитаемое имя роли на русском. */
  name: string;
  /** 2-3+ пункта ответственностей. */
  responsibilities: string[];
}

export interface TeamTemplateState {
  /** Машинный ключ (`backlog`, `in_progress`, `done`). Используется для связки с typicalTasks.stateKey. */
  key: string;
  /** Человекочитаемое имя статуса на русском (попадёт в IssueState.name). */
  name: string;
  category: TeamTemplateStateCategory;
  color: string;
  sequence: number;
}

export interface TeamTemplateTypicalTask {
  title: string;
  /** Ссылка на State.key из states[] — куда положить пример. */
  stateKey: string;
  estimatePoints?: number;
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
}

export interface TeamTemplateKpiTemplate {
  name: string;
  frequency: 'monthly' | 'weekly' | 'quarterly';
}

export interface TeamTemplateDefinition {
  roles: TeamTemplateRole[];
  states: TeamTemplateState[];
  typicalTasks: TeamTemplateTypicalTask[];
  /** Названия регламентов-заглушек, которые будут созданы как Regulation status=active. */
  regulationStubs: string[];
  kpiTemplates: TeamTemplateKpiTemplate[];
}

export interface TeamTemplateSeedEntry {
  slug: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  definition: TeamTemplateDefinition;
}

// ─────────────────────────── общие пресеты ─────────────────────────────────

const STATES_DEFAULT_5: TeamTemplateState[] = [
  { key: 'backlog', name: 'Бэклог', category: 'backlog', color: '#94A3B8', sequence: 1 },
  { key: 'in_progress', name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2 },
  { key: 'review', name: 'Согласование', category: 'started', color: '#F59E0B', sequence: 3 },
  { key: 'done', name: 'Готово', category: 'completed', color: '#10B981', sequence: 4 },
  { key: 'cancelled', name: 'Не дошёл', category: 'cancelled', color: '#EF4444', sequence: 5 },
];

// ───────────────────────── 10 системных шаблонов ───────────────────────────

const SALES: TeamTemplateSeedEntry = {
  slug: 'sales',
  name: 'Команда продаж',
  description:
    'Полный цикл работы со сделками: квалификация лидов, переговоры, договор, оплата. Для отделов B2B и B2C продаж.',
  category: 'commercial',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'sales_director',
        name: 'Руководитель отдела продаж',
        responsibilities: [
          'Планирует выручку и распределяет квоты между менеджерами',
          'Контролирует воронку и конверсию по этапам',
          'Согласовывает скидки и нестандартные условия',
        ],
      },
      {
        key: 'sales_manager',
        name: 'Менеджер по продажам',
        responsibilities: [
          'Ведёт сделки от первого контакта до подписания договора',
          'Заполняет карточку клиента и обновляет статус в трекере',
          'Передаёт оплаченные сделки в монтаж/доставку',
        ],
      },
      {
        key: 'sdr',
        name: 'Специалист по квалификации',
        responsibilities: [
          'Квалифицирует входящие заявки по методике квалификации',
          'Назначает первые встречи менеджерам',
          'Закрывает явно нецелевые заявки с пометкой причины',
        ],
      },
      {
        key: 'sales_ops',
        name: 'Аналитик продаж',
        responsibilities: [
          'Поддерживает воронку и отчёт по конверсии',
          'Готовит еженедельную сводку для руководителя',
          'Чистит дубликаты и мёртвые сделки',
        ],
      },
    ],
    states: [
      { key: 'backlog', name: 'Новый лид', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'qualified', name: 'Квалифицирован', category: 'unstarted', color: '#6366F1', sequence: 2 },
      { key: 'in_progress', name: 'В работе', category: 'started', color: '#3B82F6', sequence: 3 },
      { key: 'review', name: 'Согласование договора', category: 'started', color: '#F59E0B', sequence: 4 },
      { key: 'done', name: 'Сделка', category: 'completed', color: '#10B981', sequence: 5 },
      { key: 'cancelled', name: 'Не дошёл', category: 'cancelled', color: '#EF4444', sequence: 6 },
    ],
    typicalTasks: [
      { title: 'Связаться с новым лидом и квалифицировать', stateKey: 'backlog', estimatePoints: 1, priority: 'high' },
      { title: 'Подготовить коммерческое предложение', stateKey: 'in_progress', estimatePoints: 3, priority: 'medium' },
      { title: 'Согласовать договор с юристом', stateKey: 'review', estimatePoints: 2, priority: 'medium' },
    ],
    regulationStubs: [
      'Скрипт первого звонка с клиентом',
      'Регламент работы с CRM: обязательные поля и SLA по обновлению',
      'Политика скидок и согласования нестандартных условий',
    ],
    kpiTemplates: [
      { name: 'Выручка отдела за месяц', frequency: 'monthly' },
      { name: 'Конверсия лид → сделка', frequency: 'weekly' },
      { name: 'Среднее время сделки', frequency: 'monthly' },
    ],
  },
};

const DEVELOPMENT: TeamTemplateSeedEntry = {
  slug: 'development',
  name: 'Команда разработки',
  description:
    'Команда продуктовой разработки: бэклог, спринты, релизы, инциденты. Для команд от 3 до 12 человек.',
  category: 'technology',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'tech_lead',
        name: 'Технический лидер',
        responsibilities: [
          'Принимает архитектурные решения',
          'Проводит код-ревью критичных изменений',
          'Распределяет задачи по разработчикам с учётом нагрузки',
        ],
      },
      {
        key: 'developer',
        name: 'Разработчик',
        responsibilities: [
          'Реализует задачи спринта и сопровождает их до прода',
          'Покрывает изменения тестами',
          'Документирует нетривиальные решения',
        ],
      },
      {
        key: 'qa',
        name: 'Инженер по качеству',
        responsibilities: [
          'Готовит тест-планы и автотесты на новые фичи',
          'Проводит регрессионное тестирование перед релизом',
          'Заводит и приоритизирует дефекты',
        ],
      },
      {
        key: 'devops',
        name: 'Инженер инфраструктуры',
        responsibilities: [
          'Поддерживает CI/CD и среды (dev/staging/prod)',
          'Следит за алертами и SLO',
          'Координирует разбор инцидентов',
        ],
      },
    ],
    states: [
      { key: 'backlog', name: 'Бэклог', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'in_progress', name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2 },
      { key: 'review', name: 'На код-ревью', category: 'started', color: '#F59E0B', sequence: 3 },
      { key: 'qa', name: 'Тестирование', category: 'started', color: '#8B5CF6', sequence: 4 },
      { key: 'done', name: 'Готово', category: 'completed', color: '#10B981', sequence: 5 },
      { key: 'cancelled', name: 'Отменено', category: 'cancelled', color: '#EF4444', sequence: 6 },
    ],
    typicalTasks: [
      { title: 'Декомпозировать новую фичу на задачи', stateKey: 'backlog', estimatePoints: 2, priority: 'medium' },
      { title: 'Реализовать API-эндпоинт по спецификации', stateKey: 'in_progress', estimatePoints: 5, priority: 'high' },
      { title: 'Подготовить релизные заметки', stateKey: 'review', estimatePoints: 1, priority: 'low' },
    ],
    regulationStubs: [
      'Правила код-ревью и merge в основную ветку',
      'Регламент работы с инцидентами и пост-мортемами',
      'Стандарт документирования новых модулей',
    ],
    kpiTemplates: [
      { name: 'Доля задач, доехавших до прода в спринте', frequency: 'weekly' },
      { name: 'Время прохождения задачи от старта до прод-релиза', frequency: 'monthly' },
      { name: 'Количество инцидентов уровня P1/P2', frequency: 'monthly' },
    ],
  },
};

const INSTALLATION: TeamTemplateSeedEntry = {
  slug: 'installation',
  name: 'Команда монтажа и сервиса',
  description:
    'Выездные бригады: монтаж оборудования у клиента, плановое и аварийное обслуживание, гарантия.',
  category: 'operations',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'service_lead',
        name: 'Руководитель сервиса',
        responsibilities: [
          'Планирует расписание бригад и распределяет заявки',
          'Контролирует SLA по аварийным выездам',
          'Согласовывает закупку расходников',
        ],
      },
      {
        key: 'foreman',
        name: 'Бригадир',
        responsibilities: [
          'Принимает заявку и согласовывает время с клиентом',
          'Управляет выездом и оформляет акт выполненных работ',
          'Передаёт информацию о доп-работах в продажи',
        ],
      },
      {
        key: 'installer',
        name: 'Монтажник',
        responsibilities: [
          'Выполняет монтаж по тех-карте',
          'Фиксирует фото-отчёт на каждом этапе',
          'Сообщает о нестандартных условиях бригадиру',
        ],
      },
      {
        key: 'dispatcher',
        name: 'Диспетчер',
        responsibilities: [
          'Принимает и регистрирует заявки клиентов',
          'Отслеживает статус выездов в реальном времени',
          'Обзванивает клиентов после закрытия для оценки',
        ],
      },
    ],
    states: [
      { key: 'backlog', name: 'Заявка принята', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'scheduled', name: 'Запланирована', category: 'unstarted', color: '#6366F1', sequence: 2 },
      { key: 'in_progress', name: 'На выезде', category: 'started', color: '#3B82F6', sequence: 3 },
      { key: 'review', name: 'Согласование акта', category: 'started', color: '#F59E0B', sequence: 4 },
      { key: 'done', name: 'Закрыта', category: 'completed', color: '#10B981', sequence: 5 },
      { key: 'cancelled', name: 'Отменена', category: 'cancelled', color: '#EF4444', sequence: 6 },
    ],
    typicalTasks: [
      { title: 'Согласовать время монтажа с клиентом', stateKey: 'backlog', estimatePoints: 1, priority: 'medium' },
      { title: 'Подготовить комплект оборудования к выезду', stateKey: 'scheduled', estimatePoints: 2, priority: 'high' },
      { title: 'Оформить акт выполненных работ и собрать подпись клиента', stateKey: 'review', estimatePoints: 1, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент аварийного выезда: целевые SLA по типам неисправностей',
      'Чек-лист приёмки работ и фото-отчёта',
      'Правила работы с гарантийными случаями',
    ],
    kpiTemplates: [
      { name: 'Доля выездов в SLA', frequency: 'monthly' },
      { name: 'Среднее время от заявки до закрытия', frequency: 'weekly' },
      { name: 'Доля повторных выездов', frequency: 'monthly' },
    ],
  },
};

const MARKETING: TeamTemplateSeedEntry = {
  slug: 'marketing',
  name: 'Команда маркетинга',
  description:
    'Спрос, бренд, контент, аналитика. Запуск кампаний, работа с трафиком и контент-планом.',
  category: 'commercial',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'cmo',
        name: 'Руководитель маркетинга',
        responsibilities: [
          'Согласовывает квартальный план маркетинга и бюджет',
          'Защищает план перед собственником и продажами',
          'Контролирует ключевые показатели спроса',
        ],
      },
      {
        key: 'performance',
        name: 'Performance-маркетолог',
        responsibilities: [
          'Запускает и оптимизирует платные кампании',
          'Отслеживает стоимость лида и окупаемость каналов',
          'Готовит еженедельный отчёт по трафику',
        ],
      },
      {
        key: 'content',
        name: 'Контент-маркетолог',
        responsibilities: [
          'Ведёт контент-план и работу с авторами',
          'Готовит лендинги и материалы для запусков',
          'Согласовывает тексты с продуктом и брендом',
        ],
      },
      {
        key: 'analyst',
        name: 'Маркетинг-аналитик',
        responsibilities: [
          'Поддерживает дашборды и сквозную аналитику',
          'Проверяет корректность атрибуции каналов',
          'Готовит post-mortem по кампаниям',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Спланировать кампанию на квартал', stateKey: 'backlog', estimatePoints: 3, priority: 'high' },
      { title: 'Подготовить лендинг и креативы к запуску', stateKey: 'in_progress', estimatePoints: 5, priority: 'high' },
      { title: 'Согласовать тексты с продуктом', stateKey: 'review', estimatePoints: 1, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент запуска маркетинговой кампании',
      'Стандарт бренд-коммуникации (tone of voice)',
      'Правила приёмки креативов и UTM-метрик',
    ],
    kpiTemplates: [
      { name: 'Стоимость квалифицированного лида', frequency: 'weekly' },
      { name: 'Доля лидов из платных каналов', frequency: 'monthly' },
      { name: 'Возврат на маркетинговые инвестиции', frequency: 'quarterly' },
    ],
  },
};

const MANAGEMENT: TeamTemplateSeedEntry = {
  slug: 'management',
  name: 'Управленческая команда',
  description:
    'Топ-менеджмент компании: стратегия, цели, ключевые проекты, синхронизация подразделений.',
  category: 'management',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'ceo',
        name: 'Генеральный директор',
        responsibilities: [
          'Утверждает стратегию и квартальные цели',
          'Принимает финальные решения по найму топ-менеджеров',
          'Ведёт встречи правления',
        ],
      },
      {
        key: 'coo',
        name: 'Операционный директор',
        responsibilities: [
          'Координирует кросс-функциональные проекты',
          'Контролирует выполнение операционных KPI',
          'Эскалирует системные риски',
        ],
      },
      {
        key: 'cfo',
        name: 'Финансовый директор',
        responsibilities: [
          'Контролирует бюджет и денежный поток',
          'Готовит управленческую отчётность',
          'Согласовывает крупные расходы',
        ],
      },
      {
        key: 'chief_of_staff',
        name: 'Помощник директора',
        responsibilities: [
          'Готовит повестку и протоколы стратегических встреч',
          'Отслеживает выполнение решений правления',
          'Поддерживает обновление целевой карты',
        ],
      },
    ],
    states: [
      { key: 'backlog', name: 'Инициатива', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'in_progress', name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2 },
      { key: 'review', name: 'На правлении', category: 'started', color: '#F59E0B', sequence: 3 },
      { key: 'done', name: 'Решение принято', category: 'completed', color: '#10B981', sequence: 4 },
      { key: 'cancelled', name: 'Отклонено', category: 'cancelled', color: '#EF4444', sequence: 5 },
    ],
    typicalTasks: [
      { title: 'Подготовить квартальный обзор для правления', stateKey: 'in_progress', estimatePoints: 3, priority: 'high' },
      { title: 'Согласовать ключевые цели на квартал', stateKey: 'review', estimatePoints: 2, priority: 'high' },
      { title: 'Зафиксировать решение и назначить ответственного', stateKey: 'done', estimatePoints: 1, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент стратегических встреч и протоколов',
      'Политика принятия решений и эскалации',
      'Шаблон квартального обзора результатов',
    ],
    kpiTemplates: [
      { name: 'Доля стратегических целей с прогрессом за квартал', frequency: 'quarterly' },
      { name: 'Среднее время от инициативы до решения', frequency: 'monthly' },
    ],
  },
};

const CUSTOMER_SUPPORT: TeamTemplateSeedEntry = {
  slug: 'customer_support',
  name: 'Команда поддержки клиентов',
  description:
    'Первая и вторая линия поддержки: обращения, инциденты, обратная связь, удержание.',
  category: 'operations',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'support_lead',
        name: 'Руководитель поддержки',
        responsibilities: [
          'Контролирует SLA и CSAT',
          'Управляет графиком смен',
          'Эскалирует системные проблемы продукту',
        ],
      },
      {
        key: 'agent_l1',
        name: 'Агент первой линии',
        responsibilities: [
          'Принимает обращения и решает типовые запросы',
          'Заполняет карточку клиента и тэгирует обращение',
          'Передаёт сложные случаи на вторую линию',
        ],
      },
      {
        key: 'agent_l2',
        name: 'Агент второй линии',
        responsibilities: [
          'Расследует сложные инциденты',
          'Координирует разбор с продуктом и разработкой',
          'Готовит шаблоны ответов на типовые проблемы',
        ],
      },
      {
        key: 'qa',
        name: 'Контролёр качества',
        responsibilities: [
          'Проверяет тональность и корректность ответов',
          'Поддерживает базу знаний',
          'Готовит отчёт по качеству диалогов',
        ],
      },
    ],
    states: [
      { key: 'backlog', name: 'Новое обращение', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'in_progress', name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2 },
      { key: 'review', name: 'Ожидает клиента', category: 'started', color: '#F59E0B', sequence: 3 },
      { key: 'done', name: 'Решено', category: 'completed', color: '#10B981', sequence: 4 },
      { key: 'cancelled', name: 'Закрыто без решения', category: 'cancelled', color: '#EF4444', sequence: 5 },
    ],
    typicalTasks: [
      { title: 'Ответить клиенту по первому обращению', stateKey: 'backlog', estimatePoints: 1, priority: 'high' },
      { title: 'Эскалировать инцидент на вторую линию', stateKey: 'in_progress', estimatePoints: 2, priority: 'high' },
      { title: 'Закрыть обращение и спросить оценку', stateKey: 'review', estimatePoints: 1, priority: 'medium' },
    ],
    regulationStubs: [
      'SLA по типам обращений',
      'Регламент эскалации инцидентов',
      'Стандарт тона общения с клиентом',
    ],
    kpiTemplates: [
      { name: 'CSAT по итогам обращения', frequency: 'weekly' },
      { name: 'Доля обращений, закрытых в SLA', frequency: 'monthly' },
      { name: 'Среднее время первого ответа', frequency: 'weekly' },
    ],
  },
};

const HR: TeamTemplateSeedEntry = {
  slug: 'hr',
  name: 'Команда HR',
  description:
    'Найм, адаптация, развитие, удержание сотрудников. Работа с кандидатами и текущей командой.',
  category: 'people',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'hr_lead',
        name: 'Руководитель HR',
        responsibilities: [
          'Согласовывает план найма с руководителями подразделений',
          'Контролирует ключевые показатели найма и удержания',
          'Курирует культурные инициативы',
        ],
      },
      {
        key: 'recruiter',
        name: 'Рекрутёр',
        responsibilities: [
          'Ведёт воронку кандидатов по открытым вакансиям',
          'Проводит первичные интервью',
          'Согласовывает офферы с нанимающим менеджером',
        ],
      },
      {
        key: 'hr_partner',
        name: 'HR-партнёр',
        responsibilities: [
          'Поддерживает адаптацию и развитие сотрудников',
          'Готовит планы развития и обратную связь',
          'Сопровождает выход и эксит-интервью',
        ],
      },
      {
        key: 'hr_ops',
        name: 'Специалист HR-администрирования',
        responsibilities: [
          'Оформляет приёмы, переводы, увольнения',
          'Поддерживает HR-документы и кадровый учёт',
          'Отвечает за compliance процедур',
        ],
      },
    ],
    states: [
      { key: 'backlog', name: 'Заявка на найм', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'in_progress', name: 'Подбор', category: 'started', color: '#3B82F6', sequence: 2 },
      { key: 'review', name: 'Согласование оффера', category: 'started', color: '#F59E0B', sequence: 3 },
      { key: 'done', name: 'Нанят', category: 'completed', color: '#10B981', sequence: 4 },
      { key: 'cancelled', name: 'Отменено', category: 'cancelled', color: '#EF4444', sequence: 5 },
    ],
    typicalTasks: [
      { title: 'Согласовать профиль кандидата с нанимающим менеджером', stateKey: 'backlog', estimatePoints: 1, priority: 'medium' },
      { title: 'Провести первичные интервью пятёрки финалистов', stateKey: 'in_progress', estimatePoints: 5, priority: 'high' },
      { title: 'Подготовить и согласовать оффер', stateKey: 'review', estimatePoints: 2, priority: 'high' },
    ],
    regulationStubs: [
      'Регламент найма и испытательного срока',
      'Политика обратной связи и развития',
      'Процедура выхода сотрудника',
    ],
    kpiTemplates: [
      { name: 'Среднее время закрытия вакансии', frequency: 'monthly' },
      { name: 'Доля прошедших испытательный срок', frequency: 'quarterly' },
      { name: 'eNPS команды', frequency: 'quarterly' },
    ],
  },
};

const FINANCE: TeamTemplateSeedEntry = {
  slug: 'finance',
  name: 'Финансовая команда',
  description:
    'Бюджеты, платежи, отчётность, налоги. Поддержка финансовой дисциплины и денежного потока.',
  category: 'management',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'cfo',
        name: 'Финансовый директор',
        responsibilities: [
          'Согласовывает бюджет и денежный поток',
          'Контролирует крупные расходы и инвестиции',
          'Защищает финансовый план перед собственником',
        ],
      },
      {
        key: 'fp_a',
        name: 'Финансовый аналитик',
        responsibilities: [
          'Готовит управленческую отчётность',
          'Моделирует сценарии и план-факт',
          'Контролирует исполнение бюджета по статьям',
        ],
      },
      {
        key: 'accountant',
        name: 'Бухгалтер',
        responsibilities: [
          'Ведёт первичные документы и проводки',
          'Готовит отчётность для налоговой',
          'Контролирует платежи и закрывающие документы',
        ],
      },
      {
        key: 'treasurer',
        name: 'Казначей',
        responsibilities: [
          'Управляет ликвидностью и платёжным календарём',
          'Согласовывает заявки на оплату',
          'Контролирует остатки по счетам',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Подготовить управленческую отчётность за месяц', stateKey: 'in_progress', estimatePoints: 5, priority: 'high' },
      { title: 'Согласовать заявки на оплату на неделю', stateKey: 'review', estimatePoints: 2, priority: 'high' },
      { title: 'Закрыть период и сверить остатки', stateKey: 'review', estimatePoints: 3, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент согласования платежей',
      'Политика бюджетирования и план-факта',
      'Правила работы с первичными документами',
    ],
    kpiTemplates: [
      { name: 'Срок закрытия месяца', frequency: 'monthly' },
      { name: 'Доля платежей, согласованных вовремя', frequency: 'weekly' },
      { name: 'Отклонение факт к бюджету', frequency: 'monthly' },
    ],
  },
};

const OPERATIONS: TeamTemplateSeedEntry = {
  slug: 'operations',
  name: 'Операционная команда',
  description:
    'Сквозные операционные процессы: склад, доставка, бэк-офис, координация подразделений.',
  category: 'operations',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'ops_lead',
        name: 'Руководитель операций',
        responsibilities: [
          'Координирует кросс-функциональные процессы',
          'Контролирует операционные KPI',
          'Согласовывает стандарты с подразделениями',
        ],
      },
      {
        key: 'process_owner',
        name: 'Владелец процесса',
        responsibilities: [
          'Описывает и поддерживает регламенты процесса',
          'Контролирует исполнение и собирает обратную связь',
          'Готовит изменения в процессе и согласовывает их',
        ],
      },
      {
        key: 'coordinator',
        name: 'Координатор',
        responsibilities: [
          'Сопровождает рутинные операции по чек-листам',
          'Эскалирует отклонения',
          'Готовит еженедельную сводку по статусу',
        ],
      },
      {
        key: 'analyst',
        name: 'Операционный аналитик',
        responsibilities: [
          'Поддерживает дашборды операционных метрик',
          'Готовит разборы инцидентов и сбоев',
          'Предлагает улучшения процессов',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Регулярно собрать статусы со всех подразделений', stateKey: 'in_progress', estimatePoints: 2, priority: 'medium' },
      { title: 'Согласовать обновление регламента процесса', stateKey: 'review', estimatePoints: 3, priority: 'medium' },
      { title: 'Подготовить разбор операционного инцидента', stateKey: 'in_progress', estimatePoints: 3, priority: 'high' },
    ],
    regulationStubs: [
      'Карта ключевых операционных процессов',
      'Регламент эскалации операционных инцидентов',
      'Стандарт еженедельной сводки операций',
    ],
    kpiTemplates: [
      { name: 'Доля процессов с актуальными регламентами', frequency: 'quarterly' },
      { name: 'Количество критических операционных инцидентов', frequency: 'monthly' },
    ],
  },
};

const PRODUCT: TeamTemplateSeedEntry = {
  slug: 'product',
  name: 'Продуктовая команда',
  description:
    'Исследования, гипотезы, продуктовая стратегия, релизы. Работа со спросом и метриками продукта.',
  category: 'technology',
  isPublic: true,
  definition: {
    roles: [
      {
        key: 'cpo',
        name: 'Руководитель продукта',
        responsibilities: [
          'Утверждает продуктовую стратегию и роадмап',
          'Защищает приоритеты перед компанией',
          'Контролирует ключевые продуктовые метрики',
        ],
      },
      {
        key: 'pm',
        name: 'Продуктовый менеджер',
        responsibilities: [
          'Формулирует гипотезы и собирает требования',
          'Согласовывает релизы и приоритеты с разработкой',
          'Готовит запуски и измеряет результаты',
        ],
      },
      {
        key: 'designer',
        name: 'Дизайнер',
        responsibilities: [
          'Готовит макеты и прототипы',
          'Поддерживает дизайн-систему',
          'Проверяет интерфейсы с пользователями',
        ],
      },
      {
        key: 'researcher',
        name: 'Исследователь',
        responsibilities: [
          'Планирует и проводит пользовательские исследования',
          'Готовит инсайты и рекомендации',
          'Помогает командам принимать data-informed решения',
        ],
      },
    ],
    states: [
      { key: 'backlog', name: 'Гипотеза', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'in_progress', name: 'Исследование', category: 'started', color: '#3B82F6', sequence: 2 },
      { key: 'review', name: 'Согласование', category: 'started', color: '#F59E0B', sequence: 3 },
      { key: 'done', name: 'Релиз', category: 'completed', color: '#10B981', sequence: 4 },
      { key: 'cancelled', name: 'Отклонена', category: 'cancelled', color: '#EF4444', sequence: 5 },
    ],
    typicalTasks: [
      { title: 'Подготовить гипотезу и план проверки', stateKey: 'backlog', estimatePoints: 2, priority: 'medium' },
      { title: 'Согласовать релиз с маркетингом и поддержкой', stateKey: 'review', estimatePoints: 2, priority: 'high' },
      { title: 'Замерить метрики после релиза', stateKey: 'done', estimatePoints: 2, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент проверки продуктовых гипотез',
      'Стандарт продуктовой документации',
      'Правила приоритизации роадмапа',
    ],
    kpiTemplates: [
      { name: 'Активные пользователи (DAU/MAU)', frequency: 'weekly' },
      { name: 'Конверсия в ключевое действие', frequency: 'weekly' },
      { name: 'Доля релизов с подтверждённым эффектом', frequency: 'quarterly' },
    ],
  },
};

// ───────────────────────── 5 опциональных шаблонов ─────────────────────────

const QUALITY_CONTROL: TeamTemplateSeedEntry = {
  slug: 'quality_control',
  name: 'Команда контроля качества',
  description:
    'Контроль качества продукции и услуг: входной, операционный, выходной контроль; работа с рекламациями.',
  category: 'operations',
  isPublic: false,
  definition: {
    roles: [
      {
        key: 'qc_lead',
        name: 'Руководитель ОТК',
        responsibilities: [
          'Утверждает методики контроля',
          'Контролирует процент брака и причины',
          'Согласовывает корректирующие действия',
        ],
      },
      {
        key: 'inspector',
        name: 'Контролёр',
        responsibilities: [
          'Проводит проверки по чек-листам',
          'Фиксирует отклонения',
          'Готовит отчёт по партии',
        ],
      },
      {
        key: 'auditor',
        name: 'Аудитор',
        responsibilities: [
          'Проводит внутренние аудиты процессов',
          'Готовит рекомендации',
          'Сопровождает внешние сертификации',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Провести входной контроль партии', stateKey: 'in_progress', estimatePoints: 2, priority: 'high' },
      { title: 'Оформить рекламацию поставщику', stateKey: 'review', estimatePoints: 2, priority: 'medium' },
      { title: 'Подготовить отчёт по браку за месяц', stateKey: 'in_progress', estimatePoints: 3, priority: 'medium' },
    ],
    regulationStubs: [
      'Методики контроля по типам продукции',
      'Регламент работы с рекламациями',
    ],
    kpiTemplates: [
      { name: 'Процент брака', frequency: 'monthly' },
      { name: 'Среднее время закрытия рекламации', frequency: 'monthly' },
    ],
  },
};

const LEGAL: TeamTemplateSeedEntry = {
  slug: 'legal',
  name: 'Юридическая команда',
  description:
    'Договоры, претензии, корпоративная поддержка. Сопровождение сделок и переговоров.',
  category: 'management',
  isPublic: false,
  definition: {
    roles: [
      {
        key: 'general_counsel',
        name: 'Руководитель юридической службы',
        responsibilities: [
          'Согласовывает крупные сделки и стратегию',
          'Управляет внешними юр-консультантами',
          'Контролирует ключевые правовые риски',
        ],
      },
      {
        key: 'contract_lawyer',
        name: 'Юрист по договорам',
        responsibilities: [
          'Готовит и согласовывает договоры',
          'Поддерживает библиотеку шаблонов',
          'Сопровождает переговоры с контрагентами',
        ],
      },
      {
        key: 'litigator',
        name: 'Юрист по спорам',
        responsibilities: [
          'Ведёт претензионную и судебную работу',
          'Готовит правовые позиции',
          'Координирует работу с внешними юристами',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Согласовать договор с контрагентом', stateKey: 'in_progress', estimatePoints: 3, priority: 'high' },
      { title: 'Подготовить ответ на претензию', stateKey: 'review', estimatePoints: 2, priority: 'high' },
    ],
    regulationStubs: [
      'Регламент согласования договоров',
      'Политика работы с претензиями',
    ],
    kpiTemplates: [
      { name: 'Среднее время согласования договора', frequency: 'monthly' },
    ],
  },
};

const PROCUREMENT: TeamTemplateSeedEntry = {
  slug: 'procurement',
  name: 'Команда закупок',
  description:
    'Тендеры, поставщики, договоры на поставку, складские позиции. Снижение стоимости и риска.',
  category: 'operations',
  isPublic: false,
  definition: {
    roles: [
      {
        key: 'procurement_lead',
        name: 'Руководитель закупок',
        responsibilities: [
          'Согласовывает план закупок',
          'Управляет ключевыми поставщиками',
          'Контролирует целевые показатели экономии',
        ],
      },
      {
        key: 'buyer',
        name: 'Закупщик',
        responsibilities: [
          'Подбирает поставщиков и проводит тендеры',
          'Заключает договоры на поставку',
          'Контролирует исполнение по срокам и качеству',
        ],
      },
      {
        key: 'category_manager',
        name: 'Категорийный менеджер',
        responsibilities: [
          'Управляет ассортиментом по категории',
          'Анализирует рыночные цены',
          'Готовит стратегию по категории',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Провести тендер по позиции', stateKey: 'in_progress', estimatePoints: 5, priority: 'high' },
      { title: 'Согласовать договор поставки', stateKey: 'review', estimatePoints: 2, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент проведения тендеров',
      'Политика работы с поставщиками',
    ],
    kpiTemplates: [
      { name: 'Доля закупок через тендер', frequency: 'monthly' },
      { name: 'Экономия по итогам тендеров', frequency: 'quarterly' },
    ],
  },
};

const LOGISTICS: TeamTemplateSeedEntry = {
  slug: 'logistics',
  name: 'Команда логистики',
  description:
    'Транспорт, склад, маршруты, доставка клиентам. Координация поставок и хранения.',
  category: 'operations',
  isPublic: false,
  definition: {
    roles: [
      {
        key: 'logistics_lead',
        name: 'Руководитель логистики',
        responsibilities: [
          'Согласовывает план перевозок и хранения',
          'Контролирует целевые показатели затрат',
          'Управляет ключевыми перевозчиками',
        ],
      },
      {
        key: 'dispatcher',
        name: 'Диспетчер транспорта',
        responsibilities: [
          'Планирует маршруты и графики',
          'Контролирует выполнение рейсов',
          'Решает оперативные сбои',
        ],
      },
      {
        key: 'warehouse_lead',
        name: 'Заведующий складом',
        responsibilities: [
          'Контролирует приёмку и отгрузку',
          'Управляет остатками и инвентаризацией',
          'Поддерживает регламенты хранения',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Спланировать маршрут на неделю', stateKey: 'in_progress', estimatePoints: 2, priority: 'medium' },
      { title: 'Согласовать тариф с перевозчиком', stateKey: 'review', estimatePoints: 2, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент приёмки и отгрузки',
      'Правила работы с перевозчиками',
    ],
    kpiTemplates: [
      { name: 'Доля доставок в срок', frequency: 'weekly' },
      { name: 'Стоимость доставки на заказ', frequency: 'monthly' },
    ],
  },
};

const EVENTS: TeamTemplateSeedEntry = {
  slug: 'events',
  name: 'Команда событий',
  description:
    'Подготовка и проведение конференций, корпоративных мероприятий, выставок. Логистика и подрядчики.',
  category: 'commercial',
  isPublic: false,
  definition: {
    roles: [
      {
        key: 'event_lead',
        name: 'Руководитель событий',
        responsibilities: [
          'Утверждает портфель мероприятий и бюджеты',
          'Контролирует ключевые показатели',
          'Согласовывает крупные подрядные договоры',
        ],
      },
      {
        key: 'producer',
        name: 'Продюсер мероприятия',
        responsibilities: [
          'Управляет подготовкой конкретного мероприятия',
          'Координирует подрядчиков и площадки',
          'Контролирует бюджет и сроки',
        ],
      },
      {
        key: 'coordinator',
        name: 'Координатор',
        responsibilities: [
          'Сопровождает рутинные задачи подготовки',
          'Готовит регистрацию и встречу гостей',
          'Помогает с пост-мортемом мероприятия',
        ],
      },
    ],
    states: STATES_DEFAULT_5,
    typicalTasks: [
      { title: 'Запустить регистрацию участников', stateKey: 'in_progress', estimatePoints: 2, priority: 'high' },
      { title: 'Согласовать программу с спикерами', stateKey: 'review', estimatePoints: 3, priority: 'high' },
      { title: 'Провести разбор мероприятия и собрать обратную связь', stateKey: 'done', estimatePoints: 2, priority: 'medium' },
    ],
    regulationStubs: [
      'Регламент подготовки мероприятия',
      'Чек-лист пост-мортема',
    ],
    kpiTemplates: [
      { name: 'Доля участников, пришедших на мероприятие', frequency: 'monthly' },
      { name: 'NPS мероприятия', frequency: 'monthly' },
    ],
  },
};

/** 10 системных шаблонов (isPublic=true). */
export const SYSTEM_TEAM_TEMPLATES: readonly TeamTemplateSeedEntry[] = [
  SALES,
  DEVELOPMENT,
  INSTALLATION,
  MARKETING,
  MANAGEMENT,
  CUSTOMER_SUPPORT,
  HR,
  FINANCE,
  OPERATIONS,
  PRODUCT,
];

/** 5 опциональных шаблонов (isPublic=false). */
export const OPTIONAL_TEAM_TEMPLATES: readonly TeamTemplateSeedEntry[] = [
  QUALITY_CONTROL,
  LEGAL,
  PROCUREMENT,
  LOGISTICS,
  EVENTS,
];

/** Все 15 шаблонов в одном массиве. */
export const ALL_TEAM_TEMPLATES: readonly TeamTemplateSeedEntry[] = [
  ...SYSTEM_TEAM_TEMPLATES,
  ...OPTIONAL_TEAM_TEMPLATES,
];
