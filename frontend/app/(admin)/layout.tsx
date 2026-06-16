import type { ReactNode } from "react";

import { AdminAuthGuard } from "./AdminAuthGuard";

export default function AdminGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AdminAuthGuard>{children}</AdminAuthGuard>;
}
