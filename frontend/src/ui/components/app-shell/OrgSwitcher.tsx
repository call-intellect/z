'use client';

/**
 * `OrgSwitcher` (Фаза 0c, sub-TZ 0c.1, §5.3 ТЗ).
 *
 * Переключатель активной Org для consultant'ов и super_admin'ов.
 *
 * Поведение (см. §5.3):
 *   - 0 memberships + isSuperAdmin → текст «Режим Z-Admin». Не dropdown.
 *   - 0 memberships + не super_admin → ничего не рендерим (это аномалия —
 *     до wizard'а активной Org ещё нет, заголовок не нужен).
 *   - 1 membership → имя Org (truncate), tooltip с полным именем. Не dropdown.
 *   - 2+ memberships → DropdownMenu с переключением.
 *   - Внутри wizard'а (`/onboarding/company/*`) — `return null` сразу.
 *
 * Варианты рендера:
 *   - `variant='sidebar'` — широкая кнопка под логотип Sidebar (полная ширина
 *     минус padding).
 *   - `variant='mobile'` — компактная кнопка в MobileHeader (фиксированная
 *     ширина под бургер + лого).
 *
 * Soft-reload (см. §5.3):
 *   1. POST `/api/v1/auth/switch-org { orgId }` — backend меняет активную
 *      Org в сессии. ВРЕМЕННО: endpoint может быть не реализован — тогда
 *      падаем в catch и используем localStorage fallback (см. ниже).
 *   2. `mutate((key) => key.startsWith('/api/v1/'), undefined, { revalidate: true })`
 *      — инвалидируем все SWR-кеши.
 *   3. `router.replace(pathname)` — текущая страница перерисуется.
 *   4. Toast «Переключились в компанию: {name}».
 */

import { ChevronDown, Building2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSWRConfig } from 'swr';

import { apiClient } from '@/api/api-client';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { useMemberships, type Membership } from '@/hooks/useMemberships';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { cn } from '@/ui/shadcn/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/shadcn/tooltip';

export type OrgSwitcherProps = {
  variant: 'sidebar' | 'mobile';
};

const ACTIVE_ORG_LS_KEY = 'z.activeOrgId';

export function OrgSwitcher({ variant }: OrgSwitcherProps) {
  const pathname = usePathname() ?? '';
  // Внутри wizard'а переключатель не показываем — там Org только создаётся.
  if (pathname.startsWith('/onboarding/company')) {
    return null;
  }

  return <OrgSwitcherInner variant={variant} />;
}

function OrgSwitcherInner({ variant }: OrgSwitcherProps) {
  const { user, isSuperAdmin } = useAuth();
  const { memberships, isLoading } = useMemberships();
  const router = useRouter();
  const pathname = usePathname() ?? '/dashboard';
  const { mutate } = useSWRConfig();
  const [switching, setSwitching] = useState(false);

  if (isLoading) {
    // Скелет с фиксированной высотой — чтобы не дрожал layout.
    return (
      <div
        className={cn(
          'h-8 rounded-md bg-bg-overlay/40',
          variant === 'sidebar' ? 'w-full' : 'w-[120px]',
        )}
        aria-hidden
      />
    );
  }

  // Super-admin без org — рендерим текст «Режим Z-Admin».
  if (memberships.length === 0) {
    if (isSuperAdmin) {
      return (
        <div
          className={cn(
            'flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-tertiary',
            variant === 'sidebar' ? 'w-full' : '',
          )}
        >
          <Building2 size={14} className="shrink-0" />
          <span className="truncate">Суперадмин</span>
        </div>
      );
    }
    // Обычный пользователь без Org — switcher пуст. Дождётся wizard'а.
    return null;
  }

  // Подбираем активную Org. Источник правды — user.currentOrgId. Если в
  // memberships его нет (например, рассинхрон) — берём первую.
  const activeOrgId = user?.currentOrgId ?? null;
  const activeOrg =
    memberships.find((m) => m.id === activeOrgId) ?? memberships[0]!;

  // Одна Org — просто текст. Dropdown не нужен.
  if (memberships.length === 1) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-secondary',
                variant === 'sidebar' ? 'w-full' : '',
              )}
            >
              <Building2 size={14} className="shrink-0 text-fg-tertiary" />
              <span className="max-w-[160px] truncate">{activeOrg.name}</span>
              {activeOrg.isReferenceDemo ? (
                <span className="ml-auto rounded-full bg-chip-info-bg px-2 py-0.5 text-[10px] font-medium text-chip-info-fg">
                  Демо
                </span>
              ) : null}
            </div>
          </TooltipTrigger>
          <TooltipContent side={variant === 'sidebar' ? 'right' : 'bottom'}>
            {activeOrg.name}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const handleSwitch = async (target: Membership) => {
    if (target.id === activeOrg.id || switching) return;
    setSwitching(true);
    try {
      try {
        // TODO Фаза 0a: endpoint POST /api/v1/auth/switch-org может быть ещё
        // не реализован. Если 404/501 — используем localStorage fallback,
        // дальнейший reload подхватит активную Org из cookie/storage.
        await apiClient.post('/api/v1/auth/switch-org', { orgId: target.id });
      } catch {
        // Fallback на localStorage — не критично, всё равно делаем reload.
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(ACTIVE_ORG_LS_KEY, target.id);
        }
      }
      // Инвалидируем все SWR-кеши `/api/v1/*`.
      await mutate(
        (key) => typeof key === 'string' && key.startsWith('/api/v1/'),
        undefined,
        { revalidate: true },
      );
      router.replace(pathname);
      toast.success(`Переключились в компанию: ${target.name}`);
    } catch {
      toast.error('Не удалось переключиться, обновите страницу');
    } finally {
      setSwitching(false);
    }
  };

  const triggerClasses = cn(
    'flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors',
    'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    variant === 'sidebar' ? 'w-full justify-start' : '',
    switching ? 'cursor-wait opacity-60' : 'cursor-pointer',
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClasses} disabled={switching}>
          <Building2 size={14} className="shrink-0 text-fg-tertiary" />
          <span className="max-w-[160px] flex-1 truncate text-left">
            {activeOrg.name}
          </span>
          {activeOrg.isReferenceDemo ? (
            <span className="rounded-full bg-chip-info-bg px-2 py-0.5 text-[10px] font-medium text-chip-info-fg">
              Демо
            </span>
          ) : null}
          <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'sidebar' ? 'start' : 'end'}
        side="bottom"
        className="w-64"
      >
        <DropdownMenuLabel>Активная компания</DropdownMenuLabel>
        <DropdownMenuItem
          className="flex items-center gap-2 font-medium text-accent-fg focus:text-accent-fg"
          disabled
        >
          <span className="truncate">{activeOrg.name}</span>
          {activeOrg.isReferenceDemo ? (
            <span className="ml-auto rounded-full bg-chip-info-bg px-2 py-0.5 text-[10px] font-medium text-chip-info-fg">
              Демо
            </span>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-fg-tertiary">
          Переключиться
        </DropdownMenuLabel>
        {memberships
          .filter((m) => m.id !== activeOrg.id)
          .map((m) => (
            <DropdownMenuItem
              key={m.id}
              onSelect={(e) => {
                e.preventDefault();
                void handleSwitch(m);
              }}
              className="flex items-center gap-2"
            >
              <Building2 size={14} className="text-fg-tertiary" />
              <span className="truncate">{m.name}</span>
              {m.isReferenceDemo ? (
                <span className="ml-auto rounded-full bg-chip-info-bg px-2 py-0.5 text-[10px] font-medium text-chip-info-fg">
                  Демо
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
