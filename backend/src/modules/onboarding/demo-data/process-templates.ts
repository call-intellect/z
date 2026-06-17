import type { SeedFn } from './types';

const TEMPLATE_DEFS = [
  {
    key: 'sales_to_eng',
    name: 'Передача из Sales в Engineering',
    summary: 'Стандартный handoff клиентских договорённостей от продаж в разработку.',
    category: 'handoff',
    scope: 'org',
    isCrossFunctional: true,
    crossFunctionalScore: '0.800',
  },
  {
    key: 'customer_onboarding',
    name: 'Онбординг клиента',
    summary: 'Запуск нового клиента: kick-off, настройка, обучение, первая ценность.',
    category: 'customer',
    scope: 'org',
    isCrossFunctional: true,
    crossFunctionalScore: '0.700',
  },
  {
    key: 'bug_triage',
    name: 'Триаж багов',
    summary: 'От репорта пользователя до закрытия инцидента в Engineering.',
    category: 'quality',
    scope: 'engineering',
    isCrossFunctional: false,
    crossFunctionalScore: '0.200',
  },
] as const;

export const seedProcessTemplates: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  for (const t of TEMPLATE_DEFS) {
    const tpl = await prisma.processTemplate.create({
      data: {
        tenantId,
        name: t.name,
        summary: t.summary,
        category: t.category,
        scope: t.scope,
        status: 'active',
        isCrossFunctional: t.isCrossFunctional,
        crossFunctionalScore: t.crossFunctionalScore,
        dataClass: 'internal',
      },
    });
    ids.processTemplates[t.key] = tpl.id;
  }

  console.log(`[demo/process-templates] Создано ${TEMPLATE_DEFS.length} ProcessTemplate.`);
};
