'use client';

/**
 * `/clones` — публичный маркетплейс клонов должностей (ТЗ 2026-05-26).
 *
 * UX:
 *   - Header с описанием категории.
 *   - Sticky поиск по названию должности.
 *   - Группировка карточек по департаментам (сворачиваемые секции).
 *   - hasGrant=true → «Спросить» → /clones/[roleId].
 *   - hasGrant=false → «Запросить доступ» (тост о результате).
 *   - 1/2/3/4 кол. в зависимости от viewport.
 *
 * Слой: ApiDto (clones.api / me-clone-access.api) → DomainModel (useClones /
 * useMyCloneAccess) → UiModel этого компонента.
 */

import { ApiError } from '@/api/api-error';
import { clonesApi } from '@/api/clones.api';
import { useAuth } from '@/contexts/auth-context';
import { useClones, useMyCloneAccess } from '@/hooks/useClones';
import { CloneCard, CloneCardSkeleton } from '@/ui/clones/CloneCard';
import { CloneSearchInput } from '@/ui/clones/CloneSearchInput';
import { DepartmentSection } from '@/ui/clones/DepartmentSection';
import { EmptyCloneList } from '@/ui/clones/EmptyCloneList';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { toast } from '@/ui/shadcn/toast';
import { useEffect, useMemo, useState } from 'react';
import type { CloneListUiItem } from '@/domain/clone';

import { AdminForbidden } from '../admin/AdminStateViews';

const LAST_SEEN_GRANTS_LS_KEY = 'clones:last-seen-grants-iso';

export function ClonesMarketplaceClient() {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return <PageSkeleton />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только внутри Org."
      />
    );
  }
  return <Content orgId={currentOrgId} />;
}

function Content({ orgId }: { orgId: string }) {
  const clones = useClones(orgId);
  const myAccess = useMyCloneAccess(orgId);

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [requestingFor, setRequestingFor] = useState<string | null>(null);

  // При заходе на /clones сбрасываем "точку нового гранта" в Sidebar
  // (см. useUnseenCloneGrants / Sidebar.tsx).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        LAST_SEEN_GRANTS_LS_KEY,
        new Date().toISOString(),
      );
      window.dispatchEvent(new CustomEvent('clones:grants-seen'));
    } catch {
      // ignore — localStorage может быть отключён.
    }
  }, []);

  // Группировка по департаменту + локальный поиск.
  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = clones.items.filter((it) => {
      if (q.length === 0) return true;
      return (
        it.roleName.toLowerCase().includes(q) ||
        it.publicName.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, { name: string; items: CloneListUiItem[] }>();
    for (const it of filtered) {
      const key = it.departmentId ?? '__none__';
      const name = it.departmentName ?? 'Без отдела';
      const bucket = map.get(key) ?? { name, items: [] };
      bucket.items.push(it);
      map.set(key, bucket);
    }
    // Сортировка департаментов: «Без отдела» в конец, остальные — alpha.
    const entries = Array.from(map.entries()).sort(([ka, a], [kb, b]) => {
      if (ka === '__none__') return 1;
      if (kb === '__none__') return -1;
      return a.name.localeCompare(b.name, 'ru');
    });
    // Внутри секции — alpha по publicName.
    for (const [, v] of entries) {
      v.items.sort((a, b) => a.publicName.localeCompare(b.publicName, 'ru'));
    }
    return entries;
  }, [clones.items, searchQuery]);

  async function handleRequestAccess(roleId: string) {
    if (requestingFor) return;
    setRequestingFor(roleId);
    try {
      await clonesApi.requestAccess(orgId, 'role', roleId);
      toast.success('Запрос отправлен администратору.');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (
        code === 'not_found' ||
        code === 'http_404' ||
        /404/.test(String(code))
      ) {
        toast.message('Функция временно недоступна.', {
          description: 'Попросите администратора выдать доступ вручную.',
        });
      } else {
        toast.error('Не удалось отправить запрос.', {
          description:
            err instanceof ApiError ? err.message : 'Попробуйте ещё раз.',
        });
      }
    } finally {
      setRequestingFor(null);
    }
  }

  // ─── Error state ───
  if (clones.error && !clones.isLoading) {
    const err = clones.error;
    if (err instanceof ApiError && err.code === 'forbidden') {
      return <AdminForbidden />;
    }
    const message =
      err instanceof ApiError ? err.message : 'Не удалось загрузить клонов.';
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <Header total={0} />
        <div className="mt-4 rounded-md border border-border-subtle bg-bg-card p-6 text-sm">
          <p className="text-error">{message}</p>
          <button
            type="button"
            onClick={() => void clones.mutate()}
            className="mt-3 rounded-md border border-border-subtle px-3 py-1.5 text-xs hover:bg-bg-hover"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Header total={clones.total} />

      <div className="sticky top-0 z-10 -mx-4 mb-6 bg-bg-base px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <CloneSearchInput value={searchQuery} onChange={setSearchQuery} />
      </div>

      {clones.isLoading ? (
        <ClonesGridSkeleton />
      ) : grouped.length === 0 ? (
        searchQuery.trim().length > 0 ? (
          <EmptyCloneList kind="search" searchQuery={searchQuery.trim()} />
        ) : (
          <EmptyCloneList kind="org_empty" />
        )
      ) : (
        grouped.map(([deptKey, dept]) => (
          <DepartmentSection
            key={deptKey}
            departmentName={dept.name}
            count={dept.items.length}
            collapsed={collapsed.has(deptKey)}
            onToggle={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(deptKey)) next.delete(deptKey);
                else next.add(deptKey);
                return next;
              })
            }
          >
            {dept.items.map((it) => (
              <CloneCard
                key={it.personaId}
                item={it}
                hasGrant={myAccess.access?.has('role', it.roleId) ?? false}
                onRequestAccess={(rid) => void handleRequestAccess(rid)}
                requestAccessPending={requestingFor === it.roleId}
              />
            ))}
          </DepartmentSection>
        ))
      )}

      <p className="mt-8 text-center text-xs text-fg-tertiary sm:hidden">
        Нажмите на карточку, чтобы спросить клона.
      </p>
    </div>
  );
}

function Header({ total }: { total: number }) {
  return (
    <header className="mb-4 sm:mb-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
        Клоны должностей
      </h1>
      <p className="mt-1 text-xs text-fg-secondary sm:text-sm">
        Клон отвечает в стиле должности, опираясь на накопленные обсуждения
        подхода к решениям. Когда носитель роли меняется — клон сохраняет
        опыт и продолжает версионироваться. Всего: {total}.
      </p>
    </header>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-6 h-10 w-full" />
      <ClonesGridSkeleton />
    </div>
  );
}

function ClonesGridSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <CloneCardSkeleton key={i} />
      ))}
    </div>
  );
}
