"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/contexts/auth-context";
import { TierGate } from "@/ui/components/TierGate";
import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileOverviewClient } from "@/ui/mobile/exec/MobileOverviewClient";

import { DirectorDashboardClient } from "./DirectorDashboardClient";

export function DashboardRouter() {
  const { currentOrgRole, isSuperAdmin, isLoading } = useAuth();
  const router = useRouter();

  const isDirector =
    isSuperAdmin || currentOrgRole === "owner" || currentOrgRole === "admin";

  useEffect(() => {
    if (isLoading) return;
    if (!isDirector) {
      router.replace("/me/stand");
    }
  }, [isLoading, isDirector, router]);

  if (isLoading) {
    return null;
  }

  if (isDirector) {
    return (
      <TierGate feature="feature.dashboard_director">
        <MobileShell
          mobile={<MobileOverviewClient />}
          desktop={<DirectorDashboardClient />}
        />
      </TierGate>
    );
  }
  return null;
}
