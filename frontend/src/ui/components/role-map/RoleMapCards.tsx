"use client";

import { useMemo } from "react";
import {
  Gauge,
  GitBranch,
  Handshake,
  ScrollText,
  ShieldCheck,
  Target,
} from "lucide-react";

import type {
  AuthorityBoundaryApi,
  DecisionPolicyApi,
  InteractionApi,
  RequiredKnowledgeApi,
  ResponsibilityElementApi,
  RoleMapApi,
} from "@/api/role-map.api";
import { Badge } from "@/ui/shadcn/badge";

export const RESP_KIND_LABEL: Record<string, string> = {
  outcome: "Результат",
  function: "Функция",
  activity: "Действие",
};

export const AUTH_KIND_LABEL: Record<string, string> = {
  allowed: "Разрешено",
  requires_approval: "Согласование",
  forbidden: "Запрещено",
};

export const IMPORTANCE_LABEL: Record<string, string> = {
  mandatory: "Обязательно",
  preferred: "Желательно",
  nice_to_have: "Плюсом",
};

export const LEVEL_LABEL: Record<string, string> = {
  beginner: "начинающий",
  intermediate: "уверенный",
  expert: "эксперт",
};

export const FREQ_LABEL: Record<string, string> = {
  daily: "ежедневно",
  weekly: "еженедельно",
  monthly: "ежемесячно",
  ad_hoc: "эпизодически",
};

export const INTERACTION_KIND_LABEL: Record<string, string> = {
  reports_to: "отчитывается перед",
  collaborates_with: "сотрудничает с",
  delegates_to: "делегирует",
  receives_handoff_from: "принимает от",
  escalates_to: "эскалирует к",
  customer_facing: "работа с клиентом",
  supplier_facing: "работа с поставщиком",
  mentor_to: "наставник для",
  mentored_by: "наставляется",
  other: "другое",
};

export function CategoryCard({
  title,
  icon,
  count,
  emptyHint,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  emptyHint: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-base font-medium text-fg-primary">
          {icon}
          {title}
        </h2>
        <Badge variant="secondary">{count}</Badge>
      </header>
      {count === 0 ? (
        <p className="text-sm text-fg-tertiary">{emptyHint}</p>
      ) : (
        children
      )}
    </section>
  );
}

export function ResponsibilitiesCard({
  items,
}: {
  items: ResponsibilityElementApi[];
}) {
  const byKind = useMemo(() => {
    const m = new Map<string, ResponsibilityElementApi[]>();
    for (const r of items) {
      const arr = m.get(r.kind) ?? [];
      arr.push(r);
      m.set(r.kind, arr);
    }
    return m;
  }, [items]);
  return (
    <CategoryCard
      title="Обязанности"
      icon={<Target size={16} />}
      count={items.length}
      emptyHint="Обязанности появятся, как только агент соберёт их из встреч и документов."
    >
      <div className="space-y-3">
        {Array.from(byKind.entries()).map(([kind, arr]) => (
          <div key={kind}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
              {RESP_KIND_LABEL[kind] ?? kind}
            </h3>
            <ul className="space-y-1 text-sm">
              {arr.map((r) => (
                <li key={r.id} className="leading-snug text-fg-primary">
                  <span className="font-medium">{r.name}</span>
                  {r.description && (
                    <span className="ml-1 text-fg-secondary">
                      — {r.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CategoryCard>
  );
}

export function AuthorityCard({ items }: { items: AuthorityBoundaryApi[] }) {
  return (
    <CategoryCard
      title="Границы полномочий"
      icon={<ShieldCheck size={16} />}
      count={items.length}
      emptyHint="Границы появятся после извлечения из решений и согласований."
    >
      <ul className="space-y-2 text-sm">
        {items.map((a) => (
          <li key={a.id} className="leading-snug">
            <Badge
              variant={a.kind === "forbidden" ? "danger" : "secondary"}
              className="mr-2"
            >
              {AUTH_KIND_LABEL[a.kind] ?? a.kind}
            </Badge>
            <span className="text-fg-primary">{a.scope}</span>
            {a.approverRoleName && (
              <span className="ml-1 text-fg-tertiary">
                (через {a.approverRoleName})
              </span>
            )}
            {a.thresholdsJson?.rubles !== undefined && (
              <span className="ml-1 text-fg-tertiary">
                до {String(a.thresholdsJson.rubles)} ₽
              </span>
            )}
          </li>
        ))}
      </ul>
    </CategoryCard>
  );
}

export function KnowledgeCard({ items }: { items: RequiredKnowledgeApi[] }) {
  return (
    <CategoryCard
      title="Требуемые знания"
      icon={<ScrollText size={16} />}
      count={items.length}
      emptyHint="Знания подтягиваются из обсуждений и должностной инструкции."
    >
      <ul className="space-y-2 text-sm">
        {items.map((k) => (
          <li key={k.id} className="leading-snug">
            <Badge
              variant={k.importance === "mandatory" ? "default" : "secondary"}
              className="mr-2"
            >
              {IMPORTANCE_LABEL[k.importance] ?? k.importance}
            </Badge>
            <span className="font-medium text-fg-primary">{k.topic}</span>
            {k.expectedLevel && (
              <span className="ml-1 text-fg-tertiary">
                — {LEVEL_LABEL[k.expectedLevel] ?? k.expectedLevel}
              </span>
            )}
            {k.description && (
              <p className="mt-0.5 text-fg-secondary">{k.description}</p>
            )}
          </li>
        ))}
      </ul>
    </CategoryCard>
  );
}

export function DecisionPoliciesCard({
  items,
}: {
  items: DecisionPolicyApi[];
}) {
  return (
    <CategoryCard
      title="Политики решений"
      icon={<GitBranch size={16} />}
      count={items.length}
      emptyHint="Политики появятся, когда агент увидит повторяющиеся правила решений."
    >
      <ul className="space-y-3 text-sm">
        {items.map((d) => (
          <li key={d.id} className="leading-snug">
            <div className="font-medium text-fg-primary">{d.name}</div>
            <div className="text-fg-secondary">{d.ruleDescription}</div>
            {d.conditionDescription && (
              <div className="mt-0.5 text-xs text-fg-tertiary">
                Когда: {d.conditionDescription}
              </div>
            )}
          </li>
        ))}
      </ul>
    </CategoryCard>
  );
}

export function InteractionsCard({ items }: { items: InteractionApi[] }) {
  return (
    <CategoryCard
      title="Взаимодействия"
      icon={<Handshake size={16} />}
      count={items.length}
      emptyHint="Граф взаимодействий собирается из передач задач и совместных встреч."
    >
      <ul className="space-y-2 text-sm">
        {items.map((i) => {
          const counterpart =
            i.counterpartRoleName ??
            i.counterpartDepartmentName ??
            i.counterpartExternal ??
            "—";
          return (
            <li key={i.id} className="leading-snug">
              <span className="text-fg-secondary">
                {INTERACTION_KIND_LABEL[i.kind] ?? i.kind}
              </span>{" "}
              <span className="font-medium text-fg-primary">{counterpart}</span>
              {i.frequency && (
                <span className="ml-1 text-xs text-fg-tertiary">
                  ({FREQ_LABEL[i.frequency] ?? i.frequency})
                </span>
              )}
              {i.description && (
                <p className="mt-0.5 text-xs text-fg-tertiary">
                  {i.description}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </CategoryCard>
  );
}

export function MetricsCard({ items }: { items: RoleMapApi["metrics"] }) {
  return (
    <CategoryCard
      title="KPI и метрики"
      icon={<Gauge size={16} />}
      count={items.length}
      emptyHint="KPI можно привязать к должности через раздел метрик."
    >
      <ul className="space-y-2 text-sm">
        {items.map((m) => (
          <li key={m.id} className="leading-snug">
            <span className="font-medium text-fg-primary">{m.name}</span>
            {(m.currentValue !== null || m.targetValue !== null) && (
              <span className="ml-1 text-fg-tertiary">
                {m.currentValue !== null ? m.currentValue : "—"}
                {m.targetValue !== null ? ` / ${m.targetValue}` : ""}
                {m.unit ? ` ${m.unit}` : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </CategoryCard>
  );
}

export function RoleMapGrid({
  map,
  className,
}: {
  map: RoleMapApi;
  className?: string;
}) {
  return (
    <div
      data-testid="role-map-grid"
      className={className ?? "grid grid-cols-1 gap-4 lg:grid-cols-2"}
    >
      <ResponsibilitiesCard items={map.responsibilities} />
      <AuthorityCard items={map.authority} />
      <KnowledgeCard items={map.knowledge} />
      <DecisionPoliciesCard items={map.decisions} />
      <InteractionsCard items={map.interactions} />
      <MetricsCard items={map.metrics} />
    </div>
  );
}

export function isRoleMapEmpty(map: RoleMapApi): boolean {
  const c = map.counts;
  return (
    c.responsibilities === 0 &&
    c.authority === 0 &&
    c.knowledge === 0 &&
    c.decisions === 0 &&
    c.interactions === 0 &&
    c.metrics === 0
  );
}
