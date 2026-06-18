"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "./auth-context";
import { t } from "@/lib/i18n";

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user || user.role !== "admin") {
      router.replace("/");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-secondary">
        {t("app.loading")}
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold text-fg-primary">
          {t("admin.forbidden_title")}
        </h1>
        <p className="text-fg-secondary">{t("admin.forbidden_description")}</p>
      </div>
    );
  }

  return <>{children}</>;
}
