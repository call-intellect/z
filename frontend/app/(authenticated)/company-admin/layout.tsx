import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CompanyAdminSidebar } from "./CompanyAdminSidebar";

export const metadata: Metadata = {
  title: "Админка компании",
};

export default function CompanyAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <CompanyAdminSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
