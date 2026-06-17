"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function AdminAuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading, isSuperAdmin } = useAuth();
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();

  const isLoginPath = pathname.startsWith("/admin/login");

  useEffect(() => {
    if (isLoading) return;
    if (isLoginPath) return;
    if (!user) {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!isSuperAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isLoading, isSuperAdmin, isLoginPath, pathname, router]);

  if (isLoginPath) return <>{children}</>;

  if (isLoading || !user || !isSuperAdmin) {
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
