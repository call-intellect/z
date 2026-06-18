import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ADMIN_BRAND } from "@/ui/components/admin/brand";

import { AdminShell } from "./AdminShell";

export const metadata: Metadata = {
  title: { default: ADMIN_BRAND, template: `%s · ${ADMIN_BRAND}` },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
