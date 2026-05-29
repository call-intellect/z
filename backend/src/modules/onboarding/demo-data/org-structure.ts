/**
 * Демо-данные «ТехноСтрим» — организационная структура.
 *
 * Создаёт: CompanyProfile (1), Department (7), Role (12), Person (12),
 * Appointment (12), FunctionalDomain (5).
 * Обновляет headPersonId для 4 отделов.
 */
import type { SeedFn } from './types';

export const seedOrgStructure: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  try {
    // ── 1. CompanyProfile ────────────────────────────────────────────────

    await prisma.companyProfile.create({
      data: {
        tenantId,
        displayName: 'ТехноСтрим',
        stage: 'product-market-fit',
        missionJson: {
          text: 'Делать видеоконференции простыми и умными для каждой команды',
        },
        visionJson: {
          text: 'Платформа №1 для B2B-коммуникаций в России с AI-аналитикой',
        },
        strategyJson: {
          pillars: [
            'AI-first аналитика встреч',
            'Мобильность',
            'Enterprise-безопасность',
          ],
          targetMarket: 'B2B SaaS 50-500 сотрудников',
          arr: 'целевой ARR 10M к концу года',
        },
      },
    });

    // ── 2. Departments (7) ───────────────────────────────────────────────

    const deptDefs: { key: string; name: string }[] = [
      { key: 'leadership', name: 'Руководство' },
      { key: 'product', name: 'Продукт' },
      { key: 'engineering', name: 'Разработка' },
      { key: 'sales', name: 'Продажи' },
      { key: 'marketing', name: 'Маркетинг' },
      { key: 'support', name: 'Поддержка' },
      { key: 'hr', name: 'HR' },
    ];

    for (const d of deptDefs) {
      const dept = await prisma.department.create({
        data: { tenantId, name: d.name },
      });
      ids.departments[d.key] = dept.id;
    }

    // ── 3. Roles (12) ────────────────────────────────────────────────────

    const roleDefs: { key: string; name: string; dept: string }[] = [
      { key: 'ceo', name: 'CEO / Основатель', dept: 'leadership' },
      { key: 'cpo', name: 'CPO (Product)', dept: 'product' },
      { key: 'tech_lead', name: 'Tech Lead', dept: 'engineering' },
      { key: 'head_sales', name: 'Head of Sales', dept: 'sales' },
      { key: 'designer', name: 'Дизайнер', dept: 'product' },
      { key: 'backend_dev', name: 'Backend-разработчик', dept: 'engineering' },
      { key: 'frontend_dev', name: 'Frontend-разработчик', dept: 'engineering' },
      { key: 'marketer', name: 'Маркетолог', dept: 'marketing' },
      { key: 'sales_manager', name: 'Менеджер по продажам', dept: 'sales' },
      { key: 'customer_success', name: 'Customer Success', dept: 'support' },
      { key: 'qa_engineer', name: 'QA-инженер', dept: 'engineering' },
      { key: 'hr', name: 'HR', dept: 'hr' },
    ];

    for (const r of roleDefs) {
      const role = await prisma.role.create({
        data: {
          tenantId,
          name: r.name,
          departmentId: ids.departments[r.dept]!,
        },
      });
      ids.roles[r.key] = role.id;
    }

    // ── 4. Persons (12) ──────────────────────────────────────────────────

    interface PersonDef {
      key: string;
      name: string;
      email: string;
      dept: string;
      role: string;
      knowledgeProfile?: Record<string, unknown>;
    }

    const personDefs: PersonDef[] = [
      {
        key: 'morozov',
        name: 'Алексей Морозов',
        email: 'morozov@technostream.io',
        dept: 'leadership',
        role: 'ceo',
        knowledgeProfile: {
          expertise: ['стратегическое планирование', 'управление командой', 'B2B SaaS'],
          responsibilities: ['видение продукта', 'фандрайзинг', 'ключевые клиенты'],
          communicationStyle: 'direct, data-driven',
          decisionPatterns: ['приоритизирует метрики роста', 'делегирет техдетали Козлову'],
        },
      },
      {
        key: 'volkova',
        name: 'Марина Волкова',
        email: 'volkova@technostream.io',
        dept: 'product',
        role: 'cpo',
        knowledgeProfile: {
          expertise: ['product management', 'CustDev', 'приоритизация'],
          responsibilities: ['бэклог продукта', 'дорожная карта', 'пользовательские метрики'],
          communicationStyle: 'structured, empathetic',
          decisionPatterns: ['фокус на пользовательских метриках', 'быстрые решения на данных'],
        },
      },
      {
        key: 'kozlov',
        name: 'Дмитрий Козлов',
        email: 'kozlov@technostream.io',
        dept: 'engineering',
        role: 'tech_lead',
        knowledgeProfile: {
          expertise: ['микросервисы', 'безопасность', 'SFU-архитектура', 'OAuth2'],
          responsibilities: ['архитектура бэкенда', 'code review', 'технический долг'],
          communicationStyle: 'pragmatic, code-first',
          decisionPatterns: ['hotfix сначала, рефакторинг потом', 'берёт критические задачи на себя'],
        },
      },
      {
        key: 'sokolova',
        name: 'Екатерина Соколова',
        email: 'sokolova@technostream.io',
        dept: 'sales',
        role: 'head_sales',
        knowledgeProfile: {
          expertise: ['B2B-продажи', 'CustDev', 'презентация продукта'],
          responsibilities: ['воронка продаж', 'ключевые клиенты', 'ценообразование'],
          communicationStyle: 'energetic, client-focused',
          decisionPatterns: ['агрессивное закрытие сделок', 'знает конкурентов лучше всех'],
        },
      },
      {
        key: 'petrova',
        name: 'Анна Петрова',
        email: 'petrova@technostream.io',
        dept: 'product',
        role: 'designer',
        knowledgeProfile: {
          expertise: ['UI/UX дизайн', 'дизайн-системы', 'мобильный дизайн'],
          responsibilities: ['дизайн интерфейсов', 'дизайн-система', 'прототипирование'],
          communicationStyle: 'visual, detail-oriented',
          decisionPatterns: ['референсы перед дизайном', 'итеративный подход'],
        },
      },
      { key: 'novikov', name: 'Игорь Новиков', email: 'novikov@technostream.io', dept: 'engineering', role: 'backend_dev' },
      { key: 'sidorov', name: 'Павел Сидоров', email: 'sidorov@technostream.io', dept: 'engineering', role: 'frontend_dev' },
      { key: 'kuznetsova', name: 'Ольга Кузнецова', email: 'kuznetsova@technostream.io', dept: 'marketing', role: 'marketer' },
      { key: 'lebedev', name: 'Виктор Лебедев', email: 'lebedev@technostream.io', dept: 'sales', role: 'sales_manager' },
      { key: 'ivanova', name: 'Наталья Иванова', email: 'ivanova@technostream.io', dept: 'support', role: 'customer_success' },
      { key: 'popov', name: 'Сергей Попов', email: 'popov@technostream.io', dept: 'engineering', role: 'qa_engineer' },
      { key: 'mikhailova', name: 'Татьяна Михайлова', email: 'mikhailova@technostream.io', dept: 'hr', role: 'hr' },
    ];

    for (const p of personDefs) {
      const person = await prisma.person.create({
        data: {
          tenantId,
          name: p.name,
          email: p.email,
          primaryDepartmentId: ids.departments[p.dept]!,
          relationship: 'employee',
          knowledgeProfile: p.knowledgeProfile
            ? (p.knowledgeProfile as object)
            : undefined,
        },
      });
      ids.persons[p.key] = person.id;
    }

    // ── 5. Appointments (12) ─────────────────────────────────────────────

    for (const p of personDefs) {
      await prisma.appointment.create({
        data: {
          tenantId,
          personId: ids.persons[p.key]!,
          roleId: ids.roles[p.role]!,
          departmentId: ids.departments[p.dept]!,
          loadPercent: 100,
          status: 'active',
        },
      });
    }

    // ── 6. FunctionalDomain (5) ──────────────────────────────────────────

    const domainDefs: { name: string; slug: string }[] = [
      { name: 'Product', slug: 'product' },
      { name: 'Engineering', slug: 'engineering' },
      { name: 'Sales', slug: 'sales' },
      { name: 'Marketing', slug: 'marketing' },
      { name: 'Support', slug: 'support' },
    ];

    for (const d of domainDefs) {
      await prisma.functionalDomain.create({
        data: {
          tenantId,
          name: d.name,
          slug: d.slug,
          isSystem: true,
        },
      });
    }

    // ── 7. Обновляем headPersonId для отделов ────────────────────────────

    const headMap: [string, string][] = [
      ['leadership', 'morozov'],
      ['product', 'volkova'],
      ['engineering', 'kozlov'],
      ['sales', 'sokolova'],
    ];

    for (const [deptKey, personKey] of headMap) {
      await prisma.department.update({
        where: { id: ids.departments[deptKey]! },
        data: { headPersonId: ids.persons[personKey]! },
      });
    }

    console.log(
      `[demo/org-structure] Создано: 1 CompanyProfile, ${deptDefs.length} отделов, ` +
      `${roleDefs.length} ролей, ${personDefs.length} сотрудников, ` +
      `${personDefs.length} назначений, ${domainDefs.length} функциональных доменов.`,
    );
  } catch (error) {
    console.error('[demo/org-structure] Ошибка при создании орг-структуры:', error);
    throw error;
  }
};
