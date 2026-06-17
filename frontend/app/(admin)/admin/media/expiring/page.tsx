import type { Metadata } from "next";

import { ExpiringRecordingsTable } from "@/ui/components/admin/ExpiringRecordingsTable";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { adminRootCrumb } from "@/ui/components/admin/brand";

export const metadata: Metadata = {
  title: "Истекающие записи",
};

export default function AdminMediaExpiringPage() {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Записи и медиа" },
        { label: "Истекающие записи" },
      ]}
      title="Истекающие записи"
      description="Записи встреч, у которых TTL заканчивается в ближайшем окне. Можно продлить срок хранения вручную или забэкапить запись."
    >
      <ExpiringRecordingsTable />
    </AdminSection>
  );
}
