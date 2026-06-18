"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/contexts/auth-context";
import { EntitlementProvider } from "@/contexts/entitlement-context";
import { SubscriptionProvider } from "@/contexts/subscription-context";
import { AppShell } from "@/ui/components/app-shell/AppShell";
import { BreadcrumbProvider } from "@/ui/components/breadcrumbs/BreadcrumbContext";
import { AssistantSidebar } from "@/ui/components/dashboard/AssistantSidebar";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { TourProvider, WelcomeTourAutoStart } from "@/ui/tour";

const ONBOARDING_PATH = "/onboarding/change-password";

export function AuthenticatedShell({ children }: { children: ReactNode }) {
  const {
    user,
    isLoading,
    mustChangePassword,
    profileCompletedAt,
    isSuperAdmin,
  } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isOnboardingPath = pathname?.startsWith("/onboarding") ?? false;

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      const next = pathname && pathname !== "/" ? pathname : "/dashboard";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (mustChangePassword && !isOnboardingPath) {
      router.replace(ONBOARDING_PATH);
      return;
    }

    if (!profileCompletedAt && !isOnboardingPath && !isSuperAdmin) {
      router.replace("/onboarding/welcome/step-1");
      return;
    }
  }, [
    user,
    isLoading,
    mustChangePassword,
    profileCompletedAt,
    isOnboardingPath,
    pathname,
    router,
    isSuperAdmin,
  ]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <div className="w-full max-w-sm space-y-3 px-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (isOnboardingPath) {
    return <>{children}</>;
  }

  if (mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <Skeleton className="h-32 w-72" />
      </div>
    );
  }

  if (!profileCompletedAt && !isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <Skeleton className="h-32 w-72" />
      </div>
    );
  }

  return (
    <EntitlementProvider>
      <SubscriptionProvider>
        <TourProvider>
          <BreadcrumbProvider>
            <AppShell>{children}</AppShell>
          </BreadcrumbProvider>
          <WelcomeTourAutoStart />
          <AssistantSidebar />
        </TourProvider>
      </SubscriptionProvider>
    </EntitlementProvider>
  );
}
