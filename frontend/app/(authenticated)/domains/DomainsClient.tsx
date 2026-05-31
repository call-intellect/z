'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import Link from 'next/link';

import { ApiError } from '@/api/api-error';
import {
  functionalDomainsApi,
  type IndustrySlugApi,
} from '@/api/functional-domains.api';
import { useAuth } from '@/contexts/auth-context';
import {
  INDUSTRY_LABEL,
  toFunctionalDomain,
  type FunctionalDomainDomain,
} from '@/domain/functional-domain';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * `/domains` UI — дерево + seed-template wizard.
 */
export function DomainsClient(): JSX.Element {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной Org."
      />
    );
  }
  const canManage = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  return <DomainsContent orgId={currentOrgId} canManage={canManage} />;
}

function DomainsContent({
  orgId,
  canManage,
}: {
  orgId: string;
  canManage: boolean;
}): JSX.Element {
  const [items, setItems] = useState<FunctionalDomainDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await functionalDomainsApi.list(orgId, { includeChildren: true });
      setItems(r.items.map(toFunctionalDomain));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить домены');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSeed = useCallback(
    async (industry: IndustrySlugApi) => {
      if (!canManage) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const r = await functionalDomainsApi.seedTemplate(orgId, industry);
        setNotice(
          `Готово: создано ${r.created}, пропущено ${r.skipped} (industry=${INDUSTRY_LABEL[industry]})`,
        );
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Не удалось применить шаблон');
      } finally {
        setBusy(false);
      }
    },
    [canManage, orgId, load],
  );

  if (loading) return <AdminLoading rows={6} />;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">
          Функциональные домены
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          Дерево функциональных областей компании (Маркетинг, Продажи, …).
          Используется для оси FUNCTIONAL в графе знаний и для оценки зрелости.
          Связано с{' '}
          <Link href="/structure" className="underline">
            Структурой
          </Link>{' '}
          и{' '}
          <Link href="/maturity" className="underline">
            Зрелостью
          </Link>
          .
        </p>
      </header>

      {error && <AdminError message={error} onRetry={() => void load()} />}
      {notice && (
        <div className="rounded-md border border-success/40 bg-success/5 px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      {canManage && (
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-medium text-fg-primary">
            Применить набор по индустрии
          </h2>
          <p className="text-xs text-fg-tertiary">
            Добавит 8 базовых доменов + дочерние, специфичные для индустрии.
            Существующие домены не перезаписываются.
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(INDUSTRY_LABEL) as IndustrySlugApi[]).map((slug) => (
              <Button
                key={slug}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleSeed(slug)}
              >
                {INDUSTRY_LABEL[slug]}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <AdminEmpty
          title="Домены ещё не созданы"
          description={
            canManage
              ? 'Выберите индустрию выше, чтобы создать стартовый набор.'
              : 'Попросите администратора применить шаблон индустрии.'
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <DomainNode key={d.id} domain={d} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function DomainNode({
  domain,
  depth,
}: {
  domain: FunctionalDomainDomain;
  depth: number;
}): JSX.Element {
  return (
    <div style={{ paddingLeft: depth * 20 }}>
      <Card className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-fg-primary">{domain.name}</span>
            {domain.isSystem && (
              <span className="rounded bg-bg-overlay px-1.5 py-0.5 text-[10px] text-fg-tertiary">
                System
              </span>
            )}
            {domain.isArchived && (
              <span className="rounded bg-bg-overlay px-1.5 py-0.5 text-[10px] text-fg-tertiary">
                Архив
              </span>
            )}
          </div>
          {domain.description && (
            <p className="mt-1 text-xs text-fg-tertiary">{domain.description}</p>
          )}
          <div className="mt-1 text-[11px] text-fg-tertiary">
            slug: {domain.slug} · отделов:{' '}
            {domain.linkedDepartmentsCount}
            {domain.completenessPercent !== null
              ? ` · заполнено ${domain.completenessPercent}%`
              : ''}
          </div>
        </div>
      </Card>
      {domain.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {domain.children.map((c) => (
            <DomainNode key={c.id} domain={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
