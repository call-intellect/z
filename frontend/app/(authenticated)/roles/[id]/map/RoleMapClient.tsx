'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Gauge,
  GitBranch,
  Handshake,
  Loader2,
  ScrollText,
  ShieldCheck,
  Target,
} from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  roleMapApi,
  type AuthorityBoundaryApi,
  type DecisionPolicyApi,
  type InteractionApi,
  type RequiredKnowledgeApi,
  type ResponsibilityElementApi,
  type RoleMapApi,
  type RoleMaturityApi,
} from '@/api/role-map.api';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/ui/shadcn/badge';
import { Progress } from '@/ui/shadcn/progress';
import { Skeleton } from '@/ui/shadcn/skeleton';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '@app/(admin)/admin/AdminStateViews';

const RESP_KIND_LABEL: Record<string, string> = {
  outcome: 'Результат',
  function: 'Функция',
  activity: 'Действие',
};

const AUTH_KIND_LABEL: Record<string, string> = {
  allowed: 'Разрешено',
  requires_approval: 'Согласование',
  forbidden: 'Запрещено',
};

const IMPORTANCE_LABEL: Record<string, string> = {
  mandatory: 'Обязательно',
  preferred: 'Желательно',
  nice_to_have: 'Плюсом',
};

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'начинающий',
  intermediate: 'уверенный',
  expert: 'эксперт',
};

const FREQ_LABEL: Record<string, string> = {
  daily: 'ежедневно',
  weekly: 'еженедельно',
  monthly: 'ежемесячно',
  ad_hoc: 'эпизодически',
};

const INTERACTION_KIND_LABEL: Record<string, string> = {
  reports_to: 'отчитывается перед',
  collaborates_with: 'сотрудничает с',
  delegates_to: 'делегирует',
  receives_handoff_from: 'принимает от',
  escalates_to: 'эскалирует к',
  customer_facing: 'работа с клиентом',
  supplier_facing: 'работа с поставщиком',
  mentor_to: 'наставник для',
  mentored_by: 'наставляется',
  other: 'другое',
};

export function RoleMapClient({ roleId }: { roleId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках Org."
      />
    );
  }
  return <Content orgId={currentOrgId} roleId={roleId} />;
}

function Content({ orgId, roleId }: { orgId: string; roleId: string }) {
  const mapSwr = useSWR(['role-map', orgId, roleId], () =>
    roleMapApi.getMap(orgId, roleId),
  );
  const maturitySwr = useSWR(['role-maturity', orgId, roleId], () =>
    roleMapApi.getMaturity(orgId, roleId),
  );

  if (mapSwr.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="mt-4 h-32 w-full" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (mapSwr.error) {
    if (
      mapSwr.error instanceof ApiError &&
      (mapSwr.error.code === 'http_404' || mapSwr.error.code === 'role_not_found')
    ) {
      return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <AdminEmpty
            title="Должность не найдена"
            description="Возможно, она была удалена."
          />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <AdminError
          message={
            mapSwr.error instanceof Error
              ? mapSwr.error.message
              : 'Не удалось загрузить карту'
          }
          onRetry={() => void mapSwr.mutate()}
        />
      </div>
    );
  }

  const map = mapSwr.data;
  if (!map) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link
        href={`/roles/${roleId}`}
        className="mb-3 inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
      >
        <ArrowLeft size={12} /> К должности
      </Link>

      <Header map={map} maturity={maturitySwr.data ?? null} />

      <MissionSection map={map} />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ResponsibilitiesCard items={map.responsibilities} />
        <AuthorityCard items={map.authority} />
        <KnowledgeCard items={map.knowledge} />
        <DecisionPoliciesCard items={map.decisions} />
        <InteractionsCard items={map.interactions} />
        <MetricsCard items={map.metrics} />
      </div>

      <CompletenessBreakdownSection
        maturity={maturitySwr.data ?? null}
        loading={maturitySwr.isLoading}
      />
    </div>
  );
}

// ─────────────────────────── Header ─────────────────────────────────

function Header({
  map,
  maturity,
}: {
  map: RoleMapApi;
  maturity: RoleMaturityApi | null;
}) {
  const completenessPct = Math.round(map.completeness * 100);
  const maturityPct =
    map.maturityScore !== null ? Math.round(map.maturityScore * 100) : null;
  return (
    <header className="mb-6 rounded-lg border border-border-subtle bg-bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {map.role.name}
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {map.role.departmentName
              ? `Отдел: ${map.role.departmentName}`
              : 'Без отдела'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {map.isForming && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 size={12} className="animate-spin" />
              Формируется
            </Badge>
          )}
          {map.builtAt && (
            <span className="text-xs text-fg-tertiary">
              Собрана: {new Date(map.builtAt).toLocaleString('ru-RU')}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-fg-tertiary">
            <span>Полнота карты (9 слотов)</span>
            <span className="font-medium text-fg-primary">{completenessPct}%</span>
          </div>
          <Progress value={completenessPct} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-fg-tertiary">
            <span>Зрелость роли</span>
            <span className="font-medium text-fg-primary">
              {maturityPct === null ? '—' : `${maturityPct}%`}
            </span>
          </div>
          <Progress value={maturityPct ?? 0} />
        </div>
      </div>

      {maturity?.rationale && (
        <p className="mt-3 text-sm text-fg-secondary">{maturity.rationale}</p>
      )}
    </header>
  );
}

// ─────────────────────────── Mission ────────────────────────────────

function MissionSection({ map }: { map: RoleMapApi }) {
  if (!map.role.missionStatement) {
    return (
      <section className="mt-4 rounded-lg border border-dashed border-border-subtle bg-bg-card p-4 text-sm text-fg-tertiary">
        Миссия должности не задана — заполните её в карточке должности, чтобы
        повысить полноту карты.
      </section>
    );
  }
  return (
    <section className="mt-4 rounded-lg border border-border-subtle bg-bg-card p-4">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
        Миссия должности
      </h3>
      <p className="text-sm text-fg-primary">{map.role.missionStatement}</p>
    </section>
  );
}

// ─────────────────────────── Category Cards ─────────────────────────

function CategoryCard({
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

function ResponsibilitiesCard({
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

function AuthorityCard({ items }: { items: AuthorityBoundaryApi[] }) {
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
              variant={a.kind === 'forbidden' ? 'danger' : 'secondary'}
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

function KnowledgeCard({ items }: { items: RequiredKnowledgeApi[] }) {
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
              variant={k.importance === 'mandatory' ? 'default' : 'secondary'}
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

function DecisionPoliciesCard({ items }: { items: DecisionPolicyApi[] }) {
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

function InteractionsCard({ items }: { items: InteractionApi[] }) {
  return (
    <CategoryCard
      title="Взаимодействия"
      icon={<Handshake size={16} />}
      count={items.length}
      emptyHint="Граф взаимодействий собирается из handoff'ов и совместных встреч."
    >
      <ul className="space-y-2 text-sm">
        {items.map((i) => {
          const counterpart =
            i.counterpartRoleName ??
            i.counterpartDepartmentName ??
            i.counterpartExternal ??
            '—';
          return (
            <li key={i.id} className="leading-snug">
              <span className="text-fg-secondary">
                {INTERACTION_KIND_LABEL[i.kind] ?? i.kind}
              </span>{' '}
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

function MetricsCard({ items }: { items: RoleMapApi['metrics'] }) {
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
                {m.currentValue !== null ? m.currentValue : '—'}
                {m.targetValue !== null ? ` / ${m.targetValue}` : ''}
                {m.unit ? ` ${m.unit}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </CategoryCard>
  );
}

// ─────────────────────────── Completeness breakdown ─────────────────

function CompletenessBreakdownSection({
  maturity,
  loading,
}: {
  maturity: RoleMaturityApi | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="mt-6 rounded-lg border border-border-subtle bg-bg-card p-5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="mt-3 h-24 w-full" />
      </section>
    );
  }
  if (!maturity) return null;
  return (
    <section className="mt-6 rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-3 flex items-center gap-2">
        <Award size={16} />
        <h2 className="text-base font-medium text-fg-primary">
          Полнота по слотам
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {maturity.contributingFactors.map((f) => (
          <div
            key={f.label}
            className="flex items-center justify-between gap-2 rounded border border-border-subtle px-3 py-2"
          >
            <div className="flex items-center gap-2">
              {f.value > 0 ? (
                <span className="inline-flex h-2 w-2 rounded-full bg-success" />
              ) : (
                <AlertCircle size={14} className="text-warning" />
              )}
              <span className="text-fg-primary">{f.label}</span>
            </div>
            <span className="text-xs text-fg-tertiary">
              вес {Math.round(f.weight * 100)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
