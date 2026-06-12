'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import Link from 'next/link';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  departmentDomainLinksApi,
  functionalDomainsApi,
  type DepartmentDomainLinkApi,
  type FunctionalDomainApi,
} from '@/api/functional-domains.api';
import { orgsApi, type OrgApi } from '@/api/orgs.api';
import { departmentsApi, type DepartmentApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { DEPARTMENT_TEMPLATES } from '@/lib/department-templates';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * `/departments` UI — master-detail с FunctionalDomain-связкой.
 *
 * Левая колонка: список отделов. Правая: детали выбранного отдела +
 * управление связями с FunctionalDomain.
 */
export function DepartmentsClient(): JSX.Element {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  const canManage = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  return <DepartmentsContent orgId={currentOrgId} canManage={canManage} />;
}

function DepartmentsContent({
  orgId,
  canManage,
}: {
  orgId: string;
  canManage: boolean;
}): JSX.Element {
  const [departments, setDepartments] = useState<DepartmentApi[]>([]);
  const [domains, setDomains] = useState<FunctionalDomainApi[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [links, setLinks] = useState<DepartmentDomainLinkApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addDomainId, setAddDomainId] = useState('');
  const [org, setOrg] = useState<OrgApi | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [depsRes, domsRes, orgRes] = await Promise.all([
        departmentsApi.list(orgId),
        functionalDomainsApi.list(orgId, { includeChildren: false }),
        orgsApi.byId(orgId),
      ]);
      setDepartments(depsRes.items ?? []);
      // Плоский список доменов (для select'а связи).
      const flatten = (arr: FunctionalDomainApi[]): FunctionalDomainApi[] =>
        arr.flatMap((d) => [d, ...(d.children ? flatten(d.children) : [])]);
      setDomains(flatten(domsRes.items));
      setOrg(orgRes.org);
    } catch (err) {
      setError(humanizeApiError(err, 'Не удалось загрузить отделы'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const loadLinks = useCallback(
    async (departmentId: string) => {
      setLoadingDetail(true);
      try {
        const r = await departmentDomainLinksApi.listForDepartment(
          orgId,
          departmentId,
        );
        setLinks(r.items);
      } catch (err) {
        setError(humanizeApiError(err, 'Не удалось загрузить связи'));
        setLinks([]);
      } finally {
        setLoadingDetail(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadLinks(selectedId);
  }, [selectedId, loadLinks]);

  const handleLink = useCallback(async () => {
    if (!selectedId || !addDomainId || !canManage) return;
    setBusy(true);
    try {
      await departmentDomainLinksApi.link(orgId, selectedId, {
        domainId: addDomainId,
        role: 'secondary',
      });
      setAddDomainId('');
      await loadLinks(selectedId);
    } catch (err) {
      setError(humanizeApiError(err, 'Не удалось привязать домен'));
    } finally {
      setBusy(false);
    }
  }, [selectedId, addDomainId, canManage, orgId, loadLinks]);

  const handleUnlink = useCallback(
    async (domainId: string) => {
      if (!selectedId || !canManage) return;
      setBusy(true);
      try {
        await departmentDomainLinksApi.unlink(orgId, selectedId, domainId);
        await loadLinks(selectedId);
      } catch (err) {
        setError(humanizeApiError(err, 'Не удалось отвязать домен'));
      } finally {
        setBusy(false);
      }
    },
    [selectedId, canManage, orgId, loadLinks],
  );

  const selectedDep = useMemo(
    () => departments.find((d) => d.id === selectedId) ?? null,
    [departments, selectedId],
  );
  const linkedDomainIds = useMemo(
    () => new Set(links.map((l) => l.domainId)),
    [links],
  );
  const availableDomains = useMemo(
    () => domains.filter((d) => !linkedDomainIds.has(d.id)),
    [domains, linkedDomainIds],
  );

  if (loading) return <AdminLoading rows={6} />;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Отделы</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          Список отделов компании и их функциональная нагрузка (привязка к доменам).
          Базовый CRUD отделов — в{' '}
          <Link href="/structure" className="underline">
            Структуре
          </Link>
          ; здесь — связи Department ↔ FunctionalDomain.
        </p>
      </header>

      {error && <AdminError message={error} />}

      {org?.industry && (
        <DepartmentTemplatesPanel
          orgId={orgId}
          industry={org.industry}
          canManage={canManage}
          onDepartmentsAdded={loadList}
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        <Card className="p-2">
          {departments.length === 0 ? (
            <AdminEmpty
              title="Отделов нет"
              description="Создайте отделы во вкладке /structure."
            />
          ) : (
            <ul className="space-y-1">
              {departments.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      d.id === selectedId
                        ? 'bg-accent-muted text-accent-fg'
                        : 'hover:bg-bg-overlay'
                    }`}
                  >
                    <div className="font-medium">{d.name}</div>
                    {(d.rolesCount ?? 0) > 0 && (
                      <div className="text-[11px] text-fg-tertiary">
                        {d.rolesCount} должн.
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          {!selectedDep ? (
            <div className="text-sm text-fg-tertiary">Выберите отдел слева.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-medium text-fg-primary">
                  {selectedDep.name}
                </h2>
                <p className="text-xs text-fg-tertiary">id: {selectedDep.id}</p>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium text-fg-primary">
                  Привязанные домены
                </h3>
                {loadingDetail ? (
                  <AdminLoading rows={2} />
                ) : links.length === 0 ? (
                  <div className="text-sm text-fg-tertiary">Нет связей.</div>
                ) : (
                  <ul className="space-y-1">
                    {links.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-2"
                      >
                        <div>
                          <div className="text-sm font-medium">
                            {l.domain?.name ?? l.domainId}
                          </div>
                          <div className="text-[11px] text-fg-tertiary">
                            роль: {l.role}
                            {l.coverageRatio !== null
                              ? ` · покрытие ${Math.round(l.coverageRatio * 100)}%`
                              : ''}
                          </div>
                        </div>
                        {canManage && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void handleUnlink(l.domainId)}
                          >
                            Убрать
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {canManage && availableDomains.length > 0 && (
                <div className="space-y-2 border-t border-border-subtle pt-3">
                  <h3 className="text-sm font-medium text-fg-primary">
                    Привязать домен
                  </h3>
                  <div className="flex gap-2">
                    <select
                      value={addDomainId}
                      onChange={(e) => setAddDomainId(e.target.value)}
                      className="flex-1 rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm"
                    >
                      <option value="">— выбрать —</option>
                      {availableDomains.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={!addDomainId || busy}
                      onClick={() => void handleLink()}
                    >
                      Привязать
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── DepartmentTemplatesPanel ────────────────────────────────────────────────

const INDUSTRY_LABELS: Record<string, string> = {
  software:      'Разработка программного обеспечения',
  services:      'Услуги и агентства',
  manufacturing: 'Производство',
  retail:        'Торговля',
  construction:  'Строительство',
  finance:       'Финансы',
  education:     'Образование',
  other:         'Другое',
};

function DepartmentTemplatesPanel({
  orgId,
  industry,
  canManage,
  onDepartmentsAdded,
}: {
  orgId: string;
  industry: string;
  canManage: boolean;
  onDepartmentsAdded: () => void;
}): JSX.Element | null {
  const templates = DEPARTMENT_TEMPLATES[industry] ?? DEPARTMENT_TEMPLATES['other'] ?? [];
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);

  if (!canManage || templates.length === 0 || done) return null;

  const handleAddAll = async () => {
    setAdding(true);
    try {
      for (const name of templates) {
        await departmentsApi.create(orgId, { name });
      }
      setDone(true);
      onDepartmentsAdded();
    } catch {
      // silent
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-border-default bg-bg-subtle p-4">
      <p className="text-sm font-medium text-fg-primary mb-2">
        Шаблоны для вашей отрасли — {INDUSTRY_LABELS[industry] ?? industry}
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        {templates.map((name) => (
          <span
            key={name}
            className="rounded-md bg-bg-base px-2 py-1 text-xs text-fg-secondary border border-border-default"
          >
            {name}
          </span>
        ))}
      </div>
      <Button size="sm" onClick={() => void handleAddAll()} disabled={adding}>
        {adding ? 'Добавляю...' : 'Добавить все'}
      </Button>
    </div>
  );
}
