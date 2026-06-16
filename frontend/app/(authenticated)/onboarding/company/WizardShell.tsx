"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/ui/shadcn/button";
import { Progress } from "@/ui/shadcn/progress";
import { Skeleton } from "@/ui/shadcn/skeleton";

const TOTAL_STEPS = 5;

function stepFromPath(pathname: string | null): number {
  if (!pathname) return 1;
  const m = pathname.match(/\/onboarding\/company\/step-(\d+)/);
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= TOTAL_STEPS ? n : 1;
}

export function WizardShell({ children }: { children: ReactNode }) {
  const { user, currentOrgRole, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [guardChecked, setGuardChecked] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const step = stepFromPath(pathname);
  const progress = Math.round((step / TOTAL_STEPS) * 100);

  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    if (currentOrgRole !== "owner") {
      setRedirecting(true);
      router.replace("/dashboard");
      return;
    }
    setGuardChecked(true);
  }, [isLoading, user, currentOrgRole, router]);

  if (isLoading || !user || !guardChecked || redirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <div className="w-full max-w-md space-y-3 px-6">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="border-b border-border-subtle bg-bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-fg-tertiary">
              <span>Знакомство с компанией</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard")}
          >
            Прервать и вернуться позже
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
