import type {
  SignalType,
  IdeaBlockLinkType,
  EntityType,
  EntityLinkType,
  ThemeBranch,
  ThemeDynamic,
} from '@prisma/client';

import type { SeedFn, SeedContext, IdMap } from './types';
import { daysAgo, req } from './types';

interface IBDef {
  key: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  trustedAnswer: string;
  meetingKey: string;
}

const IDEA_BLOCKS: IBDef[] = [
  {
    key: 'ib1',
    name: 'JWT без expiration — критическая уязвимость',
    signalType: 'risk',
    confidence: 0.95,
    criticalQuestion: 'Что является самой критической уязвимостью в auth?',
    trustedAnswer: 'JWT-токены без expiration — любой перехваченный токен действует бесконечно',
    meetingKey: 'security_discussion',
  },
  {
    key: 'ib2',
    name: 'Клиенты просят интеграцию со Slack',
    signalType: 'feature_request',
    confidence: 0.85,
    criticalQuestion: 'Какой самый частый запрос от клиентов?',
    trustedAnswer: 'Интеграция со Slack для уведомлений о встречах',
    meetingKey: 'custdev_rostelecom',
  },
  {
    key: 'ib3',
    name: 'Мобильное приложение отстаёт от графика на 3 дня',
    signalType: 'risk',
    confidence: 0.9,
    criticalQuestion: 'Каков статус мобильного приложения?',
    trustedAnswer: 'Отставание 3 дня из-за сложности SDK видеозвонка',
    meetingKey: 'mobile_review',
  },
  {
    key: 'ib4',
    name: 'Козлов — единственный эксперт по auth-модулю',
    signalType: 'churn_risk',
    confidence: 0.8,
    criticalQuestion: 'Кто знает auth-модуль?',
    trustedAnswer: 'Только Козлов имеет глубокие знания auth, bus factor = 1',
    meetingKey: 'planning14',
  },
  {
    key: 'ib5',
    name: 'Решение: OAuth2 + PKCE вместо JWT',
    signalType: 'decision',
    confidence: 0.92,
    criticalQuestion: 'Какое решение по auth?',
    trustedAnswer: 'Миграция на OAuth2 + PKCE flow, затрагивает 3 микросервиса',
    meetingKey: 'security_discussion',
  },
  {
    key: 'ib6',
    name: 'Ростелеком готов к пилоту на 500 пользователей',
    signalType: 'commitment',
    confidence: 0.88,
    criticalQuestion: 'Статус пилота с Ростелеком?',
    trustedAnswer: 'Подтверждён пилот на 500 пользователей, старт июнь',
    meetingKey: 'custdev_rostelecom',
  },
  {
    key: 'ib7',
    name: 'Дизайн экрана звонка утверждён',
    signalType: 'decision',
    confidence: 0.95,
    criticalQuestion: 'Статус дизайна CallScreen?',
    trustedAnswer: 'Дизайн v3 утверждён, передан Сидорову для имплементации',
    meetingKey: 'mobile_review',
  },
  {
    key: 'ib8',
    name: 'Нужен QA-инженер в команду мобайл',
    signalType: 'process_friction',
    confidence: 0.75,
    criticalQuestion: 'Чего не хватает мобильной команде?',
    trustedAnswer: 'Нет QA — тестирование на совести разработчиков',
    meetingKey: 'mobile_review',
  },
  {
    key: 'ib9',
    name: 'Zoom снизил цены на 30%',
    signalType: 'objection',
    confidence: 0.7,
    criticalQuestion: 'Главная конкурентная угроза?',
    trustedAnswer: 'Zoom снизил цены, но клиенты недовольны поддержкой',
    meetingKey: 'custdev_rostelecom',
  },
  {
    key: 'ib10',
    name: 'Идея: записывать встречи для onboarding',
    signalType: 'idea',
    confidence: 0.65,
    criticalQuestion: 'Как улучшить onboarding?',
    trustedAnswer: 'Записывать все встречи и использовать для обучения новичков',
    meetingKey: 'retro13',
  },
  {
    key: 'ib11',
    name: 'Code review занимает > 2 дней',
    signalType: 'process_friction',
    confidence: 0.82,
    criticalQuestion: 'Главная проблема процесса?',
    trustedAnswer: 'Code review bottleneck — среднее время > 48 часов',
    meetingKey: 'retro13',
  },
  {
    key: 'ib12',
    name: 'Волкова перегружена — 3 проекта одновременно',
    signalType: 'risk',
    confidence: 0.78,
    criticalQuestion: 'Кто в зоне риска выгорания?',
    trustedAnswer: 'Волкова ведёт платформу, мобайл и CustDev одновременно',
    meetingKey: 'standup1',
  },
  {
    key: 'ib13',
    name: 'Пилот с Ростелеком — 2M ARR потенциал',
    signalType: 'commitment',
    confidence: 0.85,
    criticalQuestion: 'Какой потенциал у Ростелекома?',
    trustedAnswer: 'Пилот может привести к контракту 2M ARR',
    meetingKey: 'custdev_rostelecom',
  },
  {
    key: 'ib14',
    name: 'K8s миграция заблокирована auth-рефакторингом',
    signalType: 'risk',
    confidence: 0.9,
    criticalQuestion: 'Что блокирует Kubernetes?',
    trustedAnswer: 'PLAT-12 зависит от PLAT-7 — пока auth не готов, K8s стоит',
    meetingKey: 'planning14',
  },
  {
    key: 'ib15',
    name: 'Контент-план Q2: 4 вебинара + 12 статей',
    signalType: 'commitment',
    confidence: 0.72,
    criticalQuestion: 'Какой план контента на Q2?',
    trustedAnswer: '4 вебинара (первый — K8s) и 12 статей по тематике',
    meetingKey: 'marketing_sync',
  },
  {
    key: 'ib16',
    name: 'Нужен rate limiting на всех API',
    signalType: 'risk',
    confidence: 0.88,
    criticalQuestion: 'Что нужно для безопасности API?',
    trustedAnswer: 'Rate limiting на login, registration и всех публичных эндпоинтах',
    meetingKey: 'security_discussion',
  },
  {
    key: 'ib17',
    name: 'Дизайн-система готова на 80%',
    signalType: 'decision',
    confidence: 0.8,
    criticalQuestion: 'Статус дизайн-системы?',
    trustedAnswer: '80% компонентов готовы, CallScreen добавлен',
    meetingKey: 'mobile_review',
  },
  {
    key: 'ib18',
    name: 'Клиенты не понимают разницу тарифов',
    signalType: 'risk',
    confidence: 0.75,
    criticalQuestion: 'Почему клиенты уходят?',
    trustedAnswer: 'Непрозрачное ценообразование, нет сравнения тарифов',
    meetingKey: 'marketing_sync',
  },
  {
    key: 'ib19',
    name: 'Ретро: нужно больше async-коммуникации',
    signalType: 'idea',
    confidence: 0.68,
    criticalQuestion: 'Как улучшить коммуникацию?',
    trustedAnswer: 'Команда хочет больше async вместо встреч',
    meetingKey: 'retro13',
  },
  {
    key: 'ib20',
    name: 'Безопасность — главный приоритет Q2',
    signalType: 'decision',
    confidence: 0.93,
    criticalQuestion: 'Какой главный приоритет Q2?',
    trustedAnswer: 'Безопасность auth и rate limiting — решение CEO',
    meetingKey: 'security_discussion',
  },
];

interface IBLinkDef {
  from: string;
  to: string;
  relationType: string;
  confidence: number;
  explanation: string;
}

const IDEA_BLOCK_LINKS: IBLinkDef[] = [
  {
    from: 'ib1',
    to: 'ib5',
    relationType: 'causes',
    confidence: 0.95,
    explanation: 'Уязвимость JWT привела к решению о миграции на OAuth2',
  },
  {
    from: 'ib5',
    to: 'ib1',
    relationType: 'consequences_of',
    confidence: 0.95,
    explanation: 'OAuth2 — следствие обнаруженных уязвимостей',
  },
  {
    from: 'ib7',
    to: 'ib17',
    relationType: 'develops',
    confidence: 0.85,
    explanation: 'Утверждённый дизайн укрепляет дизайн-систему',
  },
  {
    from: 'ib14',
    to: 'ib4',
    relationType: 'develops',
    confidence: 0.8,
    explanation: 'Блокировка K8s подтверждает зависимость от Козлова',
  },
  {
    from: 'ib9',
    to: 'ib13',
    relationType: 'contradicts',
    confidence: 0.7,
    explanation: 'Zoom демпингует, но Ростелеком всё равно выбирает нас',
  },
  {
    from: 'ib14',
    to: 'ib1',
    relationType: 'causes',
    confidence: 0.9,
    explanation: 'K8s миграция зависит от исправления auth',
  },
  {
    from: 'ib8',
    to: 'ib11',
    relationType: 'shares_topic',
    confidence: 0.75,
    explanation: 'Оба связаны с процессами разработки',
  },
  {
    from: 'ib16',
    to: 'ib1',
    relationType: 'shares_topic',
    confidence: 0.88,
    explanation: 'Rate limiting — часть общей проблемы безопасности',
  },
  {
    from: 'ib2',
    to: 'ib18',
    relationType: 'shares_topic',
    confidence: 0.7,
    explanation: 'Оба — запросы/боли клиентов',
  },
  {
    from: 'ib3',
    to: 'ib12',
    relationType: 'shares_topic',
    confidence: 0.75,
    explanation: 'Отставание мобайл связано с перегрузкой Волковой',
  },
  {
    from: 'ib10',
    to: 'ib19',
    relationType: 'develops',
    confidence: 0.65,
    explanation: 'Запись встреч поддерживает идею async-коммуникации',
  },
  {
    from: 'ib15',
    to: 'ib6',
    relationType: 'shares_topic',
    confidence: 0.72,
    explanation: 'Контент-план связан с пилотом Ростелеком (кейс)',
  },
  {
    from: 'ib6',
    to: 'ib13',
    relationType: 'develops',
    confidence: 0.85,
    explanation: 'Пилот подтверждает потенциал ARR',
  },
  {
    from: 'ib20',
    to: 'ib16',
    relationType: 'develops',
    confidence: 0.93,
    explanation: 'Приоритет безопасности включает rate limiting',
  },
  {
    from: 'ib11',
    to: 'ib8',
    relationType: 'shares_topic',
    confidence: 0.75,
    explanation: 'Code review и QA — связанные процессные проблемы',
  },
];

interface EntityDef {
  key: string;
  type: string;
  canonicalName: string;
  aliases: string[];
}

const ENTITIES: EntityDef[] = [
  {
    key: 'e_rostelecom',
    type: 'customer',
    canonicalName: 'Ростелеком',
    aliases: ['ПАО Ростелеком'],
  },
  { key: 'e_sberbank', type: 'customer', canonicalName: 'Сбербанк', aliases: ['ПАО Сбербанк'] },
  { key: 'e_yandex', type: 'customer', canonicalName: 'Яндекс', aliases: ['Яндекс ООО'] },
  {
    key: 'e_platform',
    type: 'product',
    canonicalName: 'Платформа v2.0',
    aliases: ['platform v2', 'v2.0'],
  },
  {
    key: 'e_mobile',
    type: 'product',
    canonicalName: 'Мобильное приложение',
    aliases: ['мобайл', 'mobile app'],
  },
  { key: 'e_zoom', type: 'vendor', canonicalName: 'Zoom', aliases: ['Zoom Video Communications'] },
  {
    key: 'e_gmeet',
    type: 'vendor',
    canonicalName: 'Google Meet',
    aliases: ['Google Meet', 'Meet'],
  },
  { key: 'e_oauth2', type: 'topic', canonicalName: 'OAuth2', aliases: ['OAuth 2.0', 'PKCE'] },
  { key: 'e_k8s', type: 'topic', canonicalName: 'Kubernetes', aliases: ['K8s', 'kube'] },
  {
    key: 'e_security',
    type: 'topic',
    canonicalName: 'Безопасность',
    aliases: ['security', 'инфобез'],
  },
  { key: 'e_aws', type: 'vendor', canonicalName: 'AWS', aliases: ['Amazon Web Services'] },
  { key: 'e_cloudflare', type: 'vendor', canonicalName: 'Cloudflare', aliases: [] },
  {
    key: 'e_market',
    type: 'market',
    canonicalName: 'B2B видеоконференции',
    aliases: ['рынок VC', 'video conferencing'],
  },
  { key: 'e_arr_goal', type: 'goal', canonicalName: 'ARR 10M к концу года', aliases: ['ARR goal'] },
  {
    key: 'e_webinar',
    type: 'event',
    canonicalName: 'Вебинар K8s',
    aliases: ['вебинар Kubernetes'],
  },
];

interface ELinkDef {
  from: string;
  to: string;
  relationType: string;
  confidence: number;
  explanation: string;
}

const ENTITY_LINKS: ELinkDef[] = [
  {
    from: 'e_rostelecom',
    to: 'e_platform',
    relationType: 'depends_on',
    confidence: 0.9,
    explanation: 'Ростелеком использует Платформу v2.0',
  },
  {
    from: 'e_sberbank',
    to: 'e_platform',
    relationType: 'depends_on',
    confidence: 0.8,
    explanation: 'Сбербанк использует Платформу v2.0',
  },
  {
    from: 'e_yandex',
    to: 'e_gmeet',
    relationType: 'depends_on',
    confidence: 0.6,
    explanation: 'Яндекс использует Google Meet как конкурентный бенчмарк',
  },
  {
    from: 'e_platform',
    to: 'e_oauth2',
    relationType: 'depends_on',
    confidence: 0.95,
    explanation: 'Платформа v2.0 использует OAuth2 для авторизации',
  },
  {
    from: 'e_platform',
    to: 'e_k8s',
    relationType: 'depends_on',
    confidence: 0.9,
    explanation: 'Платформа v2.0 зависит от Kubernetes',
  },
  {
    from: 'e_platform',
    to: 'e_cloudflare',
    relationType: 'depends_on',
    confidence: 0.85,
    explanation: 'Платформа v2.0 использует Cloudflare',
  },
  {
    from: 'e_platform',
    to: 'e_aws',
    relationType: 'depends_on',
    confidence: 0.8,
    explanation: 'Платформа v2.0 развёрнута на AWS',
  },
  {
    from: 'e_mobile',
    to: 'e_platform',
    relationType: 'depends_on',
    confidence: 0.95,
    explanation: 'Мобильное приложение зависит от Платформы v2.0',
  },
  {
    from: 'e_zoom',
    to: 'e_market',
    relationType: 'part_of',
    confidence: 0.9,
    explanation: 'Zoom — часть рынка B2B видеоконференций',
  },
  {
    from: 'e_gmeet',
    to: 'e_market',
    relationType: 'part_of',
    confidence: 0.9,
    explanation: 'Google Meet — часть рынка B2B видеоконференций',
  },
  {
    from: 'e_zoom',
    to: 'e_platform',
    relationType: 'opposes',
    confidence: 0.85,
    explanation: 'Zoom конкурирует с Платформой v2.0',
  },
  {
    from: 'e_k8s',
    to: 'e_security',
    relationType: 'mentions_with',
    confidence: 0.7,
    explanation: 'Kubernetes связан с безопасностью инфраструктуры',
  },
  {
    from: 'e_oauth2',
    to: 'e_security',
    relationType: 'part_of',
    confidence: 0.9,
    explanation: 'OAuth2 — часть системы безопасности',
  },
  {
    from: 'e_rostelecom',
    to: 'e_webinar',
    relationType: 'mentions_with',
    confidence: 0.6,
    explanation: 'Ростелеком упоминается в контексте вебинара K8s',
  },
  {
    from: 'e_arr_goal',
    to: 'e_rostelecom',
    relationType: 'depends_on',
    confidence: 0.85,
    explanation: 'Цель ARR 10M зависит от контракта с Ростелеком',
  },
  {
    from: 'e_arr_goal',
    to: 'e_platform',
    relationType: 'depends_on',
    confidence: 0.9,
    explanation: 'Цель ARR 10M зависит от успеха Платформы v2.0',
  },
  {
    from: 'e_webinar',
    to: 'e_k8s',
    relationType: 'mentions_with',
    confidence: 0.95,
    explanation: 'Вебинар посвящён Kubernetes',
  },
  {
    from: 'e_mobile',
    to: 'e_market',
    relationType: 'part_of',
    confidence: 0.8,
    explanation: 'Мобильное приложение — часть рынка B2B видеоконференций',
  },
  {
    from: 'e_rostelecom',
    to: 'e_sberbank',
    relationType: 'mentions_with',
    confidence: 0.5,
    explanation: 'Оба — enterprise клиенты ТехноСтрим',
  },
  {
    from: 'e_zoom',
    to: 'e_gmeet',
    relationType: 'mentions_with',
    confidence: 0.85,
    explanation: 'Zoom и Google Meet — оба конкуренты',
  },
];

interface ThemeDef {
  key: string;
  name: string;
  branch: string;
  dynamic: string;
  weight: number;
  confidence: number;
  description: string;
}

const THEMES: ThemeDef[] = [
  {
    key: 'th_security',
    name: 'Безопасность и auth',
    branch: 'production',
    dynamic: 'growing',
    weight: 0.9,
    confidence: 0.92,
    description: 'Все вопросы безопасности, auth-модуль, OAuth2, rate limiting',
  },
  {
    key: 'th_mobile',
    name: 'Мобильная разработка',
    branch: 'product',
    dynamic: 'stable',
    weight: 0.8,
    confidence: 0.85,
    description: 'Мобильное приложение, дизайн, iOS/Android',
  },
  {
    key: 'th_clients',
    name: 'Рост клиентской базы',
    branch: 'sales',
    dynamic: 'growing',
    weight: 0.85,
    confidence: 0.88,
    description: 'Ростелеком, Сбербанк, пилоты, продажи',
  },
  {
    key: 'th_competitors',
    name: 'Конкурентная среда',
    branch: 'marketing',
    dynamic: 'stable',
    weight: 0.65,
    confidence: 0.72,
    description: 'Zoom, Google Meet, ценообразование',
  },
  {
    key: 'th_process',
    name: 'Процессы разработки',
    branch: 'production',
    dynamic: 'declining',
    weight: 0.6,
    confidence: 0.75,
    description: 'Code review, документация, async-коммуникация',
  },
  {
    key: 'th_content',
    name: 'Контент и маркетинг',
    branch: 'marketing',
    dynamic: 'stable',
    weight: 0.55,
    confidence: 0.68,
    description: 'Контент-план, вебинары, SEO',
  },
  {
    key: 'th_team',
    name: 'Команда и нагрузка',
    branch: 'team',
    dynamic: 'growing',
    weight: 0.75,
    confidence: 0.82,
    description: 'Перегрузка, выгорание, bus factor',
  },
];

const THEME_BLOCKS: Record<string, string[]> = {
  th_security: ['ib1', 'ib5', 'ib14', 'ib16', 'ib20'],
  th_mobile: ['ib3', 'ib7', 'ib8', 'ib17'],
  th_clients: ['ib2', 'ib6', 'ib13'],
  th_competitors: ['ib9', 'ib18'],
  th_process: ['ib10', 'ib11', 'ib19'],
  th_content: ['ib15', 'ib12'],
  th_team: ['ib4', 'ib12', 'ib3'],
};

const THEME_ENTITIES: Record<string, string[]> = {
  th_security: ['e_oauth2', 'e_security'],
  th_mobile: ['e_mobile'],
  th_clients: ['e_rostelecom', 'e_sberbank', 'e_yandex'],
  th_competitors: ['e_zoom', 'e_gmeet', 'e_market'],
  th_process: ['e_k8s'],
  th_content: ['e_webinar'],
};

const REASONING_SIGNAL_TYPES = new Set<string>([
  'reasoning',
  'rationale',
  'decision_basis',
  'expertise',
  'experience',
  'competence',
]);

interface ReasoningBlockDef {
  key: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  trustedAnswer: string;
  authorPersonKey: string;
  daysAgoCreated: number;
}

const REASONING_BLOCKS: ReasoningBlockDef[] = [
  {
    key: 'ib41',
    name: 'Козлов: почему OAuth2 + PKCE, а не refresh-token rotation',
    signalType: 'reasoning',
    confidence: 0.9,
    criticalQuestion: 'Чем обоснован выбор OAuth2 + PKCE для auth?',
    trustedAnswer:
      'PKCE закрывает перехват кода без хранения секрета на клиенте; ' +
      'rotation не решает корневую проблему бессрочных JWT, а лишь маскирует.',
    authorPersonKey: 'kozlov',
    daysAgoCreated: 6,
  },
  {
    key: 'ib42',
    name: 'Козлов: критерий, когда hotfix важнее рефакторинга',
    signalType: 'rationale',
    confidence: 0.85,
    criticalQuestion: 'Как Козлов решает hotfix vs рефакторинг?',
    trustedAnswer:
      'Если уязвимость в проде и эксплуатируема — hotfix сразу, рефакторинг ' +
      'в отдельном спринте; иначе чинить корень.',
    authorPersonKey: 'kozlov',
    daysAgoCreated: 11,
  },
  {
    key: 'ib43',
    name: 'Козлов: опыт миграции SFU-кластера на K8s',
    signalType: 'experience',
    confidence: 0.8,
    criticalQuestion: 'Какой опыт миграции медиа-стека на Kubernetes?',
    trustedAnswer:
      'TURN держать вне кластера на host-network; SFU за headless-service, ' +
      'иначе ICE-кандидаты ломаются за NAT.',
    authorPersonKey: 'kozlov',
    daysAgoCreated: 17,
  },
  {
    key: 'ib44',
    name: 'Волкова: основание приоритизации бэклога по метрикам активации',
    signalType: 'decision_basis',
    confidence: 0.88,
    criticalQuestion: 'На чём Волкова строит приоритизацию бэклога?',
    trustedAnswer:
      'Сначала фичи, двигающие activation-rate новых команд; монетизация — ' +
      'после стабилизации ядра удержания.',
    authorPersonKey: 'volkova',
    daysAgoCreated: 5,
  },
  {
    key: 'ib45',
    name: 'Волкова: почему CustDev-интервью раз в неделю обязательны',
    signalType: 'reasoning',
    confidence: 0.82,
    criticalQuestion: 'Зачем продакту еженедельный CustDev?',
    trustedAnswer:
      'Без живого голоса клиента бэклог дрейфует к внутренним гипотезам; ' +
      'недельный ритм держит решения на данных.',
    authorPersonKey: 'volkova',
    daysAgoCreated: 9,
  },
  {
    key: 'ib46',
    name: 'Соколова: экспертиза по конкурентам в enterprise-сделках',
    signalType: 'expertise',
    confidence: 0.86,
    criticalQuestion: 'Как Соколова отстраивается от Zoom в продаже?',
    trustedAnswer:
      'Демпинг Zoom бьётся через SLA-поддержку на русском и ФСТЭК-готовность; ' +
      'цену не сравнивать лоб-в-лоб, переводить на совокупную стоимость.',
    authorPersonKey: 'sokolova',
    daysAgoCreated: 7,
  },
  {
    key: 'ib47',
    name: 'Соколова: основание агрессивного закрытия сделки в Q2',
    signalType: 'decision_basis',
    confidence: 0.78,
    criticalQuestion: 'Почему форсировать закрытие Ростелекома сейчас?',
    trustedAnswer:
      'Бюджетный цикл клиента закрывается в июне; пропустим окно — сделка ' +
      'уедет на квартал и обнулит прогноз ARR.',
    authorPersonKey: 'sokolova',
    daysAgoCreated: 4,
  },
  {
    key: 'ib48',
    name: 'Морозов: основание приоритета безопасности на Q2',
    signalType: 'decision_basis',
    confidence: 0.9,
    criticalQuestion: 'Почему безопасность — главный приоритет квартала?',
    trustedAnswer:
      'Enterprise-пилоты блокируются без аудита auth; один инцидент утечки ' +
      'обнулит доверие и воронку — риск дороже любой фичи.',
    authorPersonKey: 'morozov',
    daysAgoCreated: 8,
  },
  {
    key: 'ib49',
    name: 'Морозов: компетенция в выстраивании B2B SaaS-воронки',
    signalType: 'competence',
    confidence: 0.84,
    criticalQuestion: 'В чём управленческая сильная сторона Морозова?',
    trustedAnswer:
      'Связывает продуктовые метрики с unit-экономикой; делегирует техдетали, ' +
      'держит фокус команды на growth-метриках.',
    authorPersonKey: 'morozov',
    daysAgoCreated: 14,
  },
  {
    key: 'ib50',
    name: 'Петрова: почему итеративный подход с референсами в дизайне',
    signalType: 'reasoning',
    confidence: 0.8,
    criticalQuestion: 'Как Петрова обосновывает процесс дизайна?',
    trustedAnswer:
      'Референсы до макета снимают споры о вкусе; итерации малыми шагами ' +
      'дешевле, чем большой финальный пересмотр.',
    authorPersonKey: 'petrova',
    daysAgoCreated: 10,
  },
];

async function ensureDemoAuthorEntity(
  prisma: SeedContext['prisma'],
  tenantId: string,
  personId: string,
  entityCache: Map<string, string>,
): Promise<string | null> {
  const cached = entityCache.get(personId);
  if (cached) return cached;

  const person = await prisma.person.findFirst({
    where: { id: personId, tenantId },
    select: { id: true, name: true, entityId: true },
  });
  if (!person) return null;

  if (person.entityId) {
    entityCache.set(personId, person.entityId);
    return person.entityId;
  }

  let entity = await prisma.entity.findFirst({
    where: { tenantId, type: 'person', canonicalName: person.name },
    select: { id: true },
  });
  if (!entity) {
    entity = await prisma.entity.create({
      data: {
        tenantId,
        type: 'person',
        canonicalName: person.name,
        externalSource: 'demo',
      },
      select: { id: true },
    });
  }

  await prisma.person.update({
    where: { id: person.id },
    data: { entityId: entity.id },
  });

  entityCache.set(personId, entity.id);
  return entity.id;
}

export const seedKnowledgeGraph: SeedFn = async (ctx: SeedContext, ids: IdMap) => {
  const { prisma, tenantId } = ctx;

  console.log('[knowledge-graph] Creating 20 IdeaBlocks…');

  for (const def of IDEA_BLOCKS) {
    const block = await prisma.ideaBlock.create({
      data: {
        tenantId,
        name: def.name,
        criticalQuestion: def.criticalQuestion,
        trustedAnswer: def.trustedAnswer,
        signalType: def.signalType as SignalType,
        confidence: def.confidence,
        status: 'canonical',
        dataClass: 'internal',
        tags: [`meeting:${def.meetingKey}`],
      },
    });
    ids.ideaBlocks[def.key] = block.id;
  }

  console.log(`[knowledge-graph] ✓ ${IDEA_BLOCKS.length} IdeaBlocks created`);

  const EXTRA_BLOCKS: Array<{
    key: string;
    name: string;
    signalType: SignalType;
    confidence: number;
    criticalQuestion: string;
    trustedAnswer: string;
    authorPersonKey: string;
    recipientPersonKey: string | null;
    commitmentStatus: string | null;
    commitmentDueDaysAhead: number | null;
    daysAgoCreated: number;
  }> = [
    {
      key: 'ib21',
      name: 'Морозов обещает Козлову нанять security-инженера',
      signalType: 'commitment' as SignalType,
      confidence: 0.85,
      criticalQuestion: 'Кто закроет single-point-of-failure по auth?',
      trustedAnswer: 'Найм security-инженера к 15 июня',
      authorPersonKey: 'morozov',
      recipientPersonKey: 'kozlov',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 14,
      daysAgoCreated: 5,
    },
    {
      key: 'ib22',
      name: 'Морозов обещает Волковой junior PM на разгрузку',
      signalType: 'commitment' as SignalType,
      confidence: 0.8,
      criticalQuestion: 'Как разгрузить Волкову?',
      trustedAnswer: 'Открытая вакансия PM на следующей неделе',
      authorPersonKey: 'morozov',
      recipientPersonKey: 'volkova',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 7,
      daysAgoCreated: 8,
    },
    {
      key: 'ib23',
      name: 'Морозов обещает Соколовой пересмотр sales commission',
      signalType: 'commitment' as SignalType,
      confidence: 0.75,
      criticalQuestion: 'Когда апдейт sales-комиссии?',
      trustedAnswer: 'Пересмотр после закрытия Ростелекома',
      authorPersonKey: 'morozov',
      recipientPersonKey: 'sokolova',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 30,
      daysAgoCreated: 6,
    },
    {
      key: 'ib24',
      name: 'Морозов обещает совету директоров ARR 7.5M к Q3',
      signalType: 'commitment' as SignalType,
      confidence: 0.85,
      criticalQuestion: 'ARR-обещание борду?',
      trustedAnswer: '7.5M к концу Q3',
      authorPersonKey: 'morozov',
      recipientPersonKey: 'volkova',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 60,
      daysAgoCreated: 12,
    },
    {
      key: 'ib25',
      name: 'Соколова обещает Волковой расшифровки CustDev еженедельно',
      signalType: 'commitment' as SignalType,
      confidence: 0.8,
      criticalQuestion: 'Доступ продакта к голосу клиента?',
      trustedAnswer: 'Расшифровки каждый понедельник',
      authorPersonKey: 'sokolova',
      recipientPersonKey: 'volkova',
      commitmentStatus: 'fulfilled',
      commitmentDueDaysAhead: -1,
      daysAgoCreated: 3,
    },
    {
      key: 'ib26',
      name: 'Соколова обещает Волковой sales playbook для enterprise',
      signalType: 'commitment' as SignalType,
      confidence: 0.75,
      criticalQuestion: 'Стандартизация enterprise-продаж?',
      trustedAnswer: 'Playbook к 10 июня',
      authorPersonKey: 'sokolova',
      recipientPersonKey: 'volkova',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 10,
      daysAgoCreated: 7,
    },
    {
      key: 'ib27',
      name: 'Соколова обещает Морозову закрытие Сбербанка',
      signalType: 'commitment' as SignalType,
      confidence: 0.7,
      criticalQuestion: 'Когда закроется Сбербанк?',
      trustedAnswer: 'Договор на финальной стадии — до конца месяца',
      authorPersonKey: 'sokolova',
      recipientPersonKey: 'morozov',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 20,
      daysAgoCreated: 4,
    },
    {
      key: 'ib28',
      name: 'Петрова обещает Козлову Figma-handoff для CallScreen',
      signalType: 'commitment' as SignalType,
      confidence: 0.85,
      criticalQuestion: 'Когда дизайн готов к разработке?',
      trustedAnswer: 'Файлы переданы Сидорову, копия Козлову',
      authorPersonKey: 'petrova',
      recipientPersonKey: 'kozlov',
      commitmentStatus: 'fulfilled',
      commitmentDueDaysAhead: -2,
      daysAgoCreated: 2,
    },
    {
      key: 'ib29',
      name: 'Петрова обещает Волковой обновлённый прототип онбординга',
      signalType: 'commitment' as SignalType,
      confidence: 0.8,
      criticalQuestion: 'Когда новый онбординг?',
      trustedAnswer: 'Прототип готов к 5 июня',
      authorPersonKey: 'petrova',
      recipientPersonKey: 'volkova',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 5,
      daysAgoCreated: 9,
    },
    {
      key: 'ib30',
      name: 'Волкова обещает Морозову Q3 roadmap к 25 июня',
      signalType: 'commitment' as SignalType,
      confidence: 0.85,
      criticalQuestion: 'Когда Q3 план?',
      trustedAnswer: 'Roadmap + KPI к 25 июня',
      authorPersonKey: 'volkova',
      recipientPersonKey: 'morozov',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 25,
      daysAgoCreated: 6,
    },
    {
      key: 'ib31',
      name: 'Волкова обещает Соколовой обновить pitch deck',
      signalType: 'commitment' as SignalType,
      confidence: 0.75,
      criticalQuestion: 'Pitch deck обновление?',
      trustedAnswer: 'Новый deck с AI-фичами через неделю',
      authorPersonKey: 'volkova',
      recipientPersonKey: 'sokolova',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 7,
      daysAgoCreated: 5,
    },
    {
      key: 'ib32',
      name: 'Волкова обещает Петровой timebox по дизайн-ревью',
      signalType: 'commitment' as SignalType,
      confidence: 0.7,
      criticalQuestion: 'Скорость дизайн-ревью?',
      trustedAnswer: 'Ревью в течение 48 часов',
      authorPersonKey: 'volkova',
      recipientPersonKey: 'petrova',
      commitmentStatus: 'fulfilled',
      commitmentDueDaysAhead: -3,
      daysAgoCreated: 11,
    },
    {
      key: 'ib33',
      name: 'Козлов обещает Сидорову auth-контракт для frontend',
      signalType: 'commitment' as SignalType,
      confidence: 0.85,
      criticalQuestion: 'Auth-API для фронта?',
      trustedAnswer: 'Контракт + примеры в Notion',
      authorPersonKey: 'kozlov',
      recipientPersonKey: 'kozlov',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 4,
      daysAgoCreated: 4,
    },
    {
      key: 'ib34',
      name: 'Козлов обещает Волковой OAuth2 миграцию к Sprint 15',
      signalType: 'commitment' as SignalType,
      confidence: 0.75,
      criticalQuestion: 'OAuth2 сроки?',
      trustedAnswer: 'Sprint 15 — полная миграция',
      authorPersonKey: 'kozlov',
      recipientPersonKey: 'volkova',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 21,
      daysAgoCreated: 10,
    },
    {
      key: 'ib35',
      name: 'Козлов обещает Морозову security audit раз в квартал',
      signalType: 'commitment' as SignalType,
      confidence: 0.8,
      criticalQuestion: 'Регулярность security-аудитов?',
      trustedAnswer: 'Раз в квартал начиная с Q3',
      authorPersonKey: 'kozlov',
      recipientPersonKey: 'morozov',
      commitmentStatus: 'open',
      commitmentDueDaysAhead: 45,
      daysAgoCreated: 2,
    },
    {
      key: 'ib36',
      name: 'Гэп: как разворачивать TURN-серверы в кластере',
      signalType: 'knowledge_gap' as SignalType,
      confidence: 0.7,
      criticalQuestion: 'TURN-кластер деплой?',
      trustedAnswer: 'Документации нет, разбирается Новиков',
      authorPersonKey: 'kozlov',
      recipientPersonKey: null,
      commitmentStatus: null,
      commitmentDueDaysAhead: null,
      daysAgoCreated: 18,
    },
    {
      key: 'ib37',
      name: 'Гэп: как настроить ФСТЭК-сертификацию end-to-end',
      signalType: 'knowledge_gap' as SignalType,
      confidence: 0.65,
      criticalQuestion: 'ФСТЭК — процедура?',
      trustedAnswer: 'Ищем консультанта, экспертизы внутри нет',
      authorPersonKey: 'morozov',
      recipientPersonKey: null,
      commitmentStatus: null,
      commitmentDueDaysAhead: null,
      daysAgoCreated: 22,
    },
    {
      key: 'ib38',
      name: 'Гэп: бенчмарки Telephony SIP против Twilio',
      signalType: 'knowledge_gap' as SignalType,
      confidence: 0.6,
      criticalQuestion: 'Какие альтернативы Twilio?',
      trustedAnswer: 'Не проверяли — нужен PoC',
      authorPersonKey: 'novikov',
      recipientPersonKey: null,
      commitmentStatus: null,
      commitmentDueDaysAhead: null,
      daysAgoCreated: 13,
    },
    {
      key: 'ib39',
      name: 'Гэп: правовые требования к хранению аудио по 152-ФЗ',
      signalType: 'knowledge_gap' as SignalType,
      confidence: 0.55,
      criticalQuestion: 'Срок хранения аудио в РФ?',
      trustedAnswer: 'Юрист подтвердит к концу июня',
      authorPersonKey: 'morozov',
      recipientPersonKey: null,
      commitmentStatus: null,
      commitmentDueDaysAhead: null,
      daysAgoCreated: 9,
    },
    {
      key: 'ib40',
      name: 'Гэп: как мерить latency end-to-end в LiveKit Egress',
      signalType: 'knowledge_gap' as SignalType,
      confidence: 0.7,
      criticalQuestion: 'E2E latency в Egress?',
      trustedAnswer: 'Метрик нет — нужен dashboard в Grafana',
      authorPersonKey: 'kozlov',
      recipientPersonKey: null,
      commitmentStatus: null,
      commitmentDueDaysAhead: null,
      daysAgoCreated: 15,
    },
  ];

  for (const e of EXTRA_BLOCKS) {
    const recipientId = e.recipientPersonKey ? (ids.persons[e.recipientPersonKey] ?? null) : null;
    const block = await prisma.ideaBlock.create({
      data: {
        tenantId,
        name: e.name,
        criticalQuestion: e.criticalQuestion,
        trustedAnswer: e.trustedAnswer,
        signalType: e.signalType,
        confidence: e.confidence,
        status: 'canonical',
        dataClass: 'internal',
        tags: [`author:${e.authorPersonKey}`],
        commitmentRecipientPersonId: recipientId,
        commitmentStatus: e.commitmentStatus,
        commitmentDueDate:
          e.commitmentDueDaysAhead !== null ? daysAgo(-e.commitmentDueDaysAhead) : null,
        createdAt: daysAgo(e.daysAgoCreated),
      },
    });
    ids.ideaBlocks[e.key] = block.id;
  }
  void req;

  console.log(
    `[knowledge-graph] ✓ ${EXTRA_BLOCKS.length} extra IdeaBlocks ` +
      `(${EXTRA_BLOCKS.filter((b) => b.signalType === ('commitment' as SignalType)).length} commitments).`,
  );

  console.log(
    `[knowledge-graph] Creating ${REASONING_BLOCKS.length} reasoning IdeaBlocks + subject-атрибуция…`,
  );

  const authorEntityCache = new Map<string, string>();
  let subjectLinkCount = 0;

  for (const r of REASONING_BLOCKS) {
    if (!REASONING_SIGNAL_TYPES.has(r.signalType)) {
      throw new Error(
        `[knowledge-graph] ib '${r.key}': signalType '${r.signalType}' вне reasoning-семейства`,
      );
    }

    const reasoningTags = [`author:${r.authorPersonKey}`, 'reasoning-demo'];

    const existing = await prisma.ideaBlock.findFirst({
      where: { tenantId, name: r.name },
      select: { id: true },
    });
    const block =
      existing ??
      (await prisma.ideaBlock.create({
        data: {
          tenantId,
          name: r.name,
          criticalQuestion: r.criticalQuestion,
          trustedAnswer: r.trustedAnswer,
          signalType: r.signalType as SignalType,
          confidence: r.confidence,
          status: 'canonical',
          dataClass: 'internal',
          tags: reasoningTags,
          createdAt: daysAgo(r.daysAgoCreated),
        },
        select: { id: true },
      }));
    ids.ideaBlocks[r.key] = block.id;

    const personId = ids.persons[r.authorPersonKey];
    if (!personId) {
      console.warn(
        `[knowledge-graph] ib '${r.key}': демо-Person '${r.authorPersonKey}' не найден — subject пропущен`,
      );
      continue;
    }
    const entityId = await ensureDemoAuthorEntity(prisma, tenantId, personId, authorEntityCache);
    if (!entityId) continue;

    await prisma.ideaBlockEntity.upsert({
      where: { blockId_entityId: { blockId: block.id, entityId } },
      create: {
        blockId: block.id,
        entityId,
        mentionContext: 'author',
        role: 'subject',
      },
      update: { role: 'subject', mentionContext: 'author' },
    });
    subjectLinkCount++;
  }

  console.log(
    `[knowledge-graph] ✓ ${REASONING_BLOCKS.length} reasoning IdeaBlocks, ` +
      `${subjectLinkCount} IdeaBlockEntity(role='subject') created`,
  );

  console.log('[knowledge-graph] Creating 15 IdeaBlockLinks…');

  for (const lnk of IDEA_BLOCK_LINKS) {
    await prisma.ideaBlockLink.create({
      data: {
        tenantId,
        fromBlockId: ids.ideaBlocks[lnk.from]!,
        toBlockId: ids.ideaBlocks[lnk.to]!,
        relationType: lnk.relationType as IdeaBlockLinkType,
        confidence: lnk.confidence,
        explanation: lnk.explanation,
        createdBy: 'linker',
      },
    });
  }

  console.log(`[knowledge-graph] ✓ ${IDEA_BLOCK_LINKS.length} IdeaBlockLinks created`);

  console.log('[knowledge-graph] Creating 15 Entities…');

  for (const def of ENTITIES) {
    const entity = await prisma.entity.create({
      data: {
        tenantId,
        type: def.type as EntityType,
        canonicalName: def.canonicalName,
        aliases: def.aliases,
      },
    });
    ids.entities[def.key] = entity.id;
  }

  console.log(`[knowledge-graph] ✓ ${ENTITIES.length} Entities created`);

  console.log('[knowledge-graph] Creating 20 EntityLinks…');

  for (const lnk of ENTITY_LINKS) {
    await prisma.entityLink.create({
      data: {
        tenantId,
        fromEntityId: ids.entities[lnk.from]!,
        toEntityId: ids.entities[lnk.to]!,
        relationType: lnk.relationType as EntityLinkType,
        confidence: lnk.confidence,
        explanation: lnk.explanation,
        createdBy: 'linker',
      },
    });
  }

  console.log(`[knowledge-graph] ✓ ${ENTITY_LINKS.length} EntityLinks created`);

  console.log('[knowledge-graph] Creating 7 Themes…');

  for (const def of THEMES) {
    const theme = await prisma.theme.create({
      data: {
        tenantId,
        name: def.name,
        description: def.description,
        branch: def.branch as ThemeBranch,
        dynamic: def.dynamic as ThemeDynamic,
        weight: def.weight,
        confidence: def.confidence,
        status: 'active',
      },
    });
    ids.themes[def.key] = theme.id;
  }

  console.log(`[knowledge-graph] ✓ ${THEMES.length} Themes created`);

  console.log('[knowledge-graph] Creating ThemeIdeaBlock links…');

  let tibCount = 0;
  for (const [themeKey, blockKeys] of Object.entries(THEME_BLOCKS)) {
    for (const blockKey of blockKeys) {
      await prisma.themeIdeaBlock.create({
        data: {
          themeId: ids.themes[themeKey]!,
          blockId: ids.ideaBlocks[blockKey]!,
          weight: 1.0,
        },
      });
      tibCount++;
    }
  }

  console.log(`[knowledge-graph] ✓ ${tibCount} ThemeIdeaBlock links created`);

  console.log('[knowledge-graph] Creating ThemeEntity links…');

  let teCount = 0;
  for (const [themeKey, entityKeys] of Object.entries(THEME_ENTITIES)) {
    for (const entityKey of entityKeys) {
      await prisma.themeEntity.create({
        data: {
          themeId: ids.themes[themeKey]!,
          entityId: ids.entities[entityKey]!,
        },
      });
      teCount++;
    }
  }

  console.log(`[knowledge-graph] ✓ ${teCount} ThemeEntity links created`);

  console.log(
    '[knowledge-graph] ✓ Knowledge graph seeded: ' +
      `20 IdeaBlocks, ${EXTRA_BLOCKS.length} extra, ${REASONING_BLOCKS.length} reasoning, ` +
      `15 IdeaBlockLinks, 15 Entities (+ авторские person-Entity), 20 EntityLinks, ` +
      `7 Themes, ${tibCount} ThemeIdeaBlock, ${teCount} ThemeEntity, ` +
      `${subjectLinkCount} IdeaBlockEntity(role='subject')`,
  );
};
