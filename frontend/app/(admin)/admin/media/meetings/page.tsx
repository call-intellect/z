import type { Metadata } from "next";

import { AdminMeetingsTable } from "@/ui/components/admin/AdminMeetingsTable";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { adminRootCrumb } from "@/ui/components/admin/brand";

export const metadata: Metadata = {
  title: "Все встречи",
};

export default function AdminMediaMeetingsPage() {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Записи и медиа" },
        { label: "Все встречи" },
      ]}
      title="Все встречи"
      description="Глобальный список встреч всех Org с фильтрами по статусу, типу и владельцу. Кликните по строке, чтобы открыть детали и записи."
    >
      <AdminMeetingsTable />
    </AdminSection>
  );
}
