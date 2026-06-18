"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function OrchestratorAuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading, isSuperAdmin, currentOrgRole } = useAuth();
  const router = useRouter();

  const allowed = isSuperAdmin || currentOrgRole === "owner";

  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    if (!allowed) {
      router.replace("/dashboard");
    }
  }, [user, isLoading, allowed, router]);

  if (isLoading || !user || !allowed) {
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

  return <>{children}</>;
}
