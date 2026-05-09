'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { ProfileSection } from './sections/ProfileSection';
import { SecuritySection } from './sections/SecuritySection';
import { AppearanceSection } from './sections/AppearanceSection';

const TABS = ['profile', 'security', 'appearance'] as const;
type SettingsTab = (typeof TABS)[number];

function isSettingsTab(value: string | null): value is SettingsTab {
  return !!value && (TABS as readonly string[]).includes(value);
}

/**
 * Страница «Настройки» в три таба:
 *   - Профиль (PATCH /me)
 *   - Безопасность (POST /me/change-password)
 *   - Внешний вид (тема через ThemeProvider)
 *
 * Активный таб синхронизирован с `?tab=` — это позволяет dropdown в sidebar
 * вести `Сменить пароль` на `/settings?tab=security`.
 */
export function SettingsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : 'profile';

  const onTabChange = useCallback(
    (value: string) => {
      const url = value === 'profile' ? '/settings' : `/settings?tab=${value}`;
      router.replace(url, { scroll: false });
    },
    [router],
  );

  return (
    <div className="w-full">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Настройки
        </h1>
        <p className="text-sm text-fg-secondary">
          Профиль, безопасность и внешний вид кабинета.
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="profile">Профиль</TabsTrigger>
          <TabsTrigger value="security">Безопасность</TabsTrigger>
          <TabsTrigger value="appearance">Внешний вид</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileSection />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySection />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
