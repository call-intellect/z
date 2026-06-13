'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { Building2, IdCard, Users } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { AdminForbidden } from '@app/(admin)/admin/AdminStateViews';
import { DepartmentsTab } from './DepartmentsTab';
import { RolesTab } from './RolesTab';
import { PersonsTab } from './PersonsTab';
import { StructureWidgets } from './StructureWidgets';

type TabKey = 'departments' | 'roles' | 'persons';

const TAB_KEYS: TabKey[] = ['persons', 'departments', 'roles'];

function readTab(sp: URLSearchParams | null): TabKey {
  const t = sp?.get('tab');
  return t && (TAB_KEYS as string[]).includes(t) ? (t as TabKey) : 'persons';
}

export function StructureClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { currentOrgId, currentOrgRole, isLoading } = useAuth();

  const tab = readTab(sp);
  const canEdit = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  // Виджеты «здоровье/пульс» — только руководителю (как dashboard-эндпоинты:
  // team-health / people-at-risk отдают 403 для manager).
  const canViewWidgets =
    currentOrgRole === 'owner' ||
    currentOrgRole === 'admin' ||
    currentOrgRole === 'coo';

  const setTab = useCallback(
    (next: string) => {
      const params = new URLSearchParams(sp?.toString() ?? '');
      params.set('tab', next);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, sp],
  );

  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках организации."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Команда
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Сотрудники, отделы и должности компании. {canEdit ? '' : 'Просмотр.'}
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="persons">
            <Users size={14} />
            <span>Сотрудники</span>
          </TabsTrigger>
          <TabsTrigger value="departments">
            <Building2 size={14} />
            <span>Отделы</span>
          </TabsTrigger>
          <TabsTrigger value="roles">
            <IdCard size={14} />
            <span>Должности</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <DepartmentsTab orgId={currentOrgId} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="roles">
          <RolesTab orgId={currentOrgId} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="persons">
          <PersonsTab orgId={currentOrgId} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      {canViewWidgets && <StructureWidgets orgId={currentOrgId} />}
    </div>
  );
}
