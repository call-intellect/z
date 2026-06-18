"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Tabs as TabsRoot,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/ui/shadcn/tabs";
import { cn } from "@/ui/shadcn/lib/utils";
import type { LucideIcon } from "lucide-react";

export type AdminTabDef = {
  value: string;
  label: string;
  icon?: LucideIcon;
  hidden?: boolean;
  badge?: ReactNode;
};

type Props = {
  tabs: AdminTabDef[];
  paramName?: string;
  defaultTab?: string;
  children: (activeTab: string) => ReactNode;
  className?: string;
};

export function AdminTabs({
  tabs,
  paramName = "tab",
  defaultTab,
  children,
  className,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const visibleTabs = useMemo(() => tabs.filter((t) => !t.hidden), [tabs]);
  const fallback = defaultTab ?? visibleTabs[0]?.value ?? "";

  const urlTab = searchParams?.get(paramName) ?? null;
  const knownValue = visibleTabs.some((t) => t.value === urlTab)
    ? (urlTab as string)
    : fallback;

  const [active, setActive] = useState<string>(knownValue);

  useEffect(() => {
    if (knownValue && knownValue !== active) {
      setActive(knownValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownValue]);

  const everActiveRef = useRef<Set<string>>(new Set([active]));
  if (!everActiveRef.current.has(active)) {
    everActiveRef.current.add(active);
  }

  const setTabInUrl = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (value === fallback) {
        next.delete(paramName);
      } else {
        next.set(paramName, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ""), {
        scroll: false,
      });
    },
    [router, pathname, paramName, fallback, searchParams],
  );

  const onValueChange = useCallback(
    (next: string) => {
      setActive(next);
      setTabInUrl(next);
    },
    [setTabInUrl],
  );

  return (
    <TabsRoot
      value={active}
      onValueChange={onValueChange}
      className={cn("flex w-full flex-col gap-4", className)}
    >
      <TabsList className="overflow-x-auto">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <TabsTrigger key={t.value} value={t.value}>
              {Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden /> : null}
              <span>{t.label}</span>
              {t.badge ? (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-bg-overlay px-1.5 text-[10px] font-medium text-fg-secondary">
                  {t.badge}
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {visibleTabs.map((t) => {
        const hasBeenActive = everActiveRef.current.has(t.value);
        return (
          <TabsContent
            key={t.value}
            value={t.value}
            forceMount={hasBeenActive ? true : undefined}
            hidden={active !== t.value}
            className={cn(active !== t.value && "hidden")}
          >
            {hasBeenActive ? children(t.value) : null}
          </TabsContent>
        );
      })}
    </TabsRoot>
  );
}
