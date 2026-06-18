import type { Metadata } from "next";

import { SecurityClient } from "./SecurityClient";

export const metadata: Metadata = {
  title: "Безопасность",
};

export default function AdminPlatformSecurityPage() {
  return <SecurityClient />;
}
