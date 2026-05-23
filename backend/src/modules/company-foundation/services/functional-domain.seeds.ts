/**
 * SBA α-9 wave 3 — seed-данные FunctionalDomain.
 *
 * Источник правды для BASE_FUNCTIONAL_DOMAINS — sub-TZ §2.
 * Per-industry-надстройки — основа в коде, дополнена разумным контентом
 * (см. SaaS / Девелопер / Ритейл / Производство / B2B-услуги).
 *
 * Дублируется в `scripts/seed-functional-domains.ts` через import (DRY).
 */

export interface BaseDomainSeed {
  name: string;
  slug: string;
  description?: string;
  iconName?: string;
  order?: number;
}

export interface IndustryDomainSeed extends BaseDomainSeed {
  /** Slug базового домена, к которому подвешиваем дочку (null = root). */
  parentSlug?: string | null;
}

export const BASE_FUNCTIONAL_DOMAINS: ReadonlyArray<BaseDomainSeed> = [
  {
    name: 'Маркетинг',
    slug: 'marketing',
    description: 'Привлечение внимания целевой аудитории, бренд, контент, PR.',
    iconName: 'Megaphone',
    order: 10,
  },
  {
    name: 'Продажи',
    slug: 'sales',
    description: 'Перевод лидов в сделки, переговоры, работа с клиентами.',
    iconName: 'TrendingUp',
    order: 20,
  },
  {
    name: 'Разработка продукта',
    slug: 'product',
    description: 'Проектирование, R&D, производство ценности для клиента.',
    iconName: 'Lightbulb',
    order: 30,
  },
  {
    name: 'Производство и операции',
    slug: 'operations',
    description: 'Выполнение заказов, логистика, поддержка процессов.',
    iconName: 'Settings',
    order: 40,
  },
  {
    name: 'Клиентский сервис',
    slug: 'customer-service',
    description: 'Поддержка клиентов, retention, обработка обращений.',
    iconName: 'Headphones',
    order: 50,
  },
  {
    name: 'HR и команда',
    slug: 'hr',
    description: 'Найм, развитие, культура, удержание сотрудников.',
    iconName: 'Users',
    order: 60,
  },
  {
    name: 'Финансы',
    slug: 'finance',
    description: 'Учёт, бюджеты, юнит-экономика, движение денежных средств.',
    iconName: 'Wallet',
    order: 70,
  },
  {
    name: 'Стратегия и управление',
    slug: 'strategy',
    description: 'Цели, OKR, инвестиции времени и капитала, риски.',
    iconName: 'Target',
    order: 80,
  },
];

export type IndustrySlug =
  | 'saas'
  | 'developer'
  | 'retail'
  | 'manufacturing'
  | 'b2b_services';

export const INDUSTRY_DOMAIN_TEMPLATES: Record<
  IndustrySlug,
  ReadonlyArray<IndustryDomainSeed>
> = {
  // ─── SaaS ─────────────────────────────────────────────────────────
  saas: [
    {
      name: 'Customer success',
      slug: 'customer-success',
      description: 'Onboarding, активация, расширение использования продукта.',
      parentSlug: 'customer-service',
      iconName: 'HeartHandshake',
      order: 51,
    },
    {
      name: 'Product analytics',
      slug: 'product-analytics',
      description: 'Метрики продукта, retention, активация, A/B-тесты.',
      parentSlug: 'product',
      iconName: 'BarChart',
      order: 31,
    },
    {
      name: 'DevOps и инфраструктура',
      slug: 'devops',
      description: 'CI/CD, мониторинг, SLA, инциденты.',
      parentSlug: 'operations',
      iconName: 'Server',
      order: 41,
    },
    {
      name: 'Growth-маркетинг',
      slug: 'growth-marketing',
      description: 'Performance, paid каналы, content/SEO, реферальные программы.',
      parentSlug: 'marketing',
      iconName: 'Rocket',
      order: 11,
    },
    {
      name: 'Inside sales',
      slug: 'inside-sales',
      description: 'SDR, BDR, телефонные / онлайн-продажи.',
      parentSlug: 'sales',
      iconName: 'Phone',
      order: 21,
    },
  ],
  // ─── Девелопер (строительство недвижимости) ────────────────────────
  developer: [
    {
      name: 'Земельный банк',
      slug: 'land-bank',
      description: 'Поиск, сделки и оформление земельных участков.',
      parentSlug: 'strategy',
      iconName: 'Landmark',
      order: 81,
    },
    {
      name: 'Проектирование',
      slug: 'design',
      description: 'Архитектура, инженерные сети, согласования.',
      parentSlug: 'product',
      iconName: 'Compass',
      order: 32,
    },
    {
      name: 'Стройка',
      slug: 'construction',
      description: 'Подрядчики, графики, контроль качества.',
      parentSlug: 'operations',
      iconName: 'HardHat',
      order: 42,
    },
    {
      name: 'Продажи объектов',
      slug: 'real-estate-sales',
      description: 'Брокеры, рассрочки, ипотека, сделки купли-продажи.',
      parentSlug: 'sales',
      iconName: 'Home',
      order: 22,
    },
    {
      name: 'Сервис УК',
      slug: 'management-company',
      description: 'Эксплуатация введённых объектов, общение с жителями.',
      parentSlug: 'customer-service',
      iconName: 'Building2',
      order: 52,
    },
  ],
  // ─── Ритейл ────────────────────────────────────────────────────────
  retail: [
    {
      name: 'Закупки и категорийный менеджмент',
      slug: 'category-management',
      description: 'Поставщики, ассортимент, ценообразование, промо.',
      parentSlug: 'operations',
      iconName: 'PackageOpen',
      order: 43,
    },
    {
      name: 'Логистика и склад',
      slug: 'logistics',
      description: 'Доставка, складские остатки, инвентаризации.',
      parentSlug: 'operations',
      iconName: 'Truck',
      order: 44,
    },
    {
      name: 'Розничная сеть',
      slug: 'retail-network',
      description: 'Магазины, мерчандайзинг, кассы, директор сети.',
      parentSlug: 'sales',
      iconName: 'Store',
      order: 23,
    },
    {
      name: 'E-commerce',
      slug: 'ecommerce',
      description: 'Маркетплейсы, собственный интернет-магазин, доставка.',
      parentSlug: 'sales',
      iconName: 'ShoppingCart',
      order: 24,
    },
    {
      name: 'Программа лояльности',
      slug: 'loyalty',
      description: 'CRM-маркетинг, рассылки, бонусы и баллы.',
      parentSlug: 'marketing',
      iconName: 'BadgePercent',
      order: 12,
    },
  ],
  // ─── Производство ─────────────────────────────────────────────────
  manufacturing: [
    {
      name: 'Цех и производство',
      slug: 'shop-floor',
      description: 'Сменное производство, оборудование, мастера.',
      parentSlug: 'operations',
      iconName: 'Factory',
      order: 45,
    },
    {
      name: 'Контроль качества',
      slug: 'quality-control',
      description: 'Входной контроль, ОТК, сертификация продукции.',
      parentSlug: 'operations',
      iconName: 'BadgeCheck',
      order: 46,
    },
    {
      name: 'Снабжение',
      slug: 'supply',
      description: 'Закупки сырья, переговоры с поставщиками, складские остатки.',
      parentSlug: 'operations',
      iconName: 'Package',
      order: 47,
    },
    {
      name: 'Конструкторское бюро',
      slug: 'engineering-bureau',
      description: 'Разработка изделий, чертежи, испытания, R&D.',
      parentSlug: 'product',
      iconName: 'Wrench',
      order: 33,
    },
    {
      name: 'Охрана труда',
      slug: 'occupational-safety',
      description: 'Инструктажи, средства защиты, аудиты безопасности.',
      parentSlug: 'hr',
      iconName: 'ShieldCheck',
      order: 61,
    },
  ],
  // ─── B2B-услуги (агентство / консалтинг / интегратор) ─────────────
  b2b_services: [
    {
      name: 'Проектное управление',
      slug: 'project-management',
      description: 'Сроки, ресурсы, ритм проектов, статусы для заказчика.',
      parentSlug: 'operations',
      iconName: 'GanttChart',
      order: 48,
    },
    {
      name: 'Аккаунтинг и клиентский успех',
      slug: 'account-management',
      description: 'Удержание клиентов, апсейлы, продление контрактов.',
      parentSlug: 'customer-service',
      iconName: 'Briefcase',
      order: 53,
    },
    {
      name: 'Pre-sale и пресейл-эксперты',
      slug: 'presale',
      description: 'Технические продажи, RFP, демо, сметы.',
      parentSlug: 'sales',
      iconName: 'FileSignature',
      order: 25,
    },
    {
      name: 'Экспертиза и методология',
      slug: 'expertise',
      description: 'Стандарты услуг, чек-листы, шаблоны, наставничество.',
      parentSlug: 'product',
      iconName: 'BookOpen',
      order: 34,
    },
    {
      name: 'Биллинг и контракты',
      slug: 'billing-and-contracts',
      description: 'Договоры, акты, выставление счетов, дебиторка.',
      parentSlug: 'finance',
      iconName: 'Receipt',
      order: 71,
    },
  ],
};
