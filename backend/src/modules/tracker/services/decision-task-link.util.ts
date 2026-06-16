import type { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * A10 (2026-06-14) — замыкание петли next-step → IntakeIssue.sourceBlockIds →
 * Issue → DecisionTaskLink('derived').
 *
 * После промоута IntakeIssue в Issue (ручной triage accept ИЛИ авто-приём в
 * IntakeAutoTriageWorker) связываем созданную задачу со всеми Decision той же
 * Org, чьи `sourceBlockIds` пересекаются с `sourceBlockIds` задачи — задача
 * считается «производной» (derived) от решения.
 *
 * Логика пересечения скопирована из эталона
 * `backend/scripts/backfill-decision-linked-task-count.ts`:
 *   1. Найти Decisions той же Org, у которых `sourceBlockIds hasSome` блоков задачи.
 *   2. `createMany` DecisionTaskLink(linkType='derived', skipDuplicates) — @@unique
 *      (decisionId, issueId) + skipDuplicates гарантируют идемпотентность.
 *   3. Пересчитать `Decision.linkedTaskCount` по фактическим строкам линка.
 *
 * Best-effort и идемпотентно:
 *   - Пустой `sourceBlockIds` → no-op (без запросов к Decision).
 *   - Повторный вызов (тот же Issue) → skipDuplicates, счётчик стабилен.
 *   - tenant-скоуп обязателен (decision.tenantId = tenantId).
 *
 * Возвращает число СОЗДАННЫХ строк линка (для логов/метрик).
 */
export async function linkDerivedDecisionsForIssue(
  prisma: PrismaService,
  args: {
    tenantId: string;
    issueId: string;
    sourceBlockIds: string[];
  },
): Promise<number> {
  const blockIds = (args.sourceBlockIds ?? []).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (blockIds.length === 0) return 0;

  // Decisions той же Org, чьи sourceBlockIds пересекаются с блоками задачи.
  const decisions = await prisma.decision.findMany({
    where: {
      tenantId: args.tenantId,
      sourceBlockIds: { hasSome: blockIds },
    },
    select: { id: true },
    take: 2_000,
  });
  if (decisions.length === 0) return 0;

  const res = await prisma.decisionTaskLink.createMany({
    data: decisions.map((d) => ({
      decisionId: d.id,
      issueId: args.issueId,
      linkType: 'derived',
    })),
    skipDuplicates: true,
  });

  // Пересчёт денормализованного счётчика по фактическим строкам линка — ровно
  // как в backfill-скрипте (count(DecisionTaskLink) per decision). Идемпотентно:
  // повтор выставит то же значение.
  if (res.count > 0) {
    const grouped = await prisma.decisionTaskLink.groupBy({
      by: ['decisionId'],
      where: { decisionId: { in: decisions.map((d) => d.id) } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      await prisma.decision.update({
        where: { id: g.decisionId },
        data: { linkedTaskCount: g._count._all },
      });
    }
  }

  return res.count;
}
