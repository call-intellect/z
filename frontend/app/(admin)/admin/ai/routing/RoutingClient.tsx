"use client";

import { AdminSection } from "@/ui/components/admin/AdminSection";

import { AiModelsClient } from "../../ai-models/AiModelsClient";
import { adminRootCrumb } from "@/ui/components/admin/brand";

export function RoutingClient() {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "AI и модели" },
        { label: "Роутинг моделей" },
      ]}
      title="Роутинг моделей"
      description="Цепочка primary → secondary → tertiary для каждого taskType. Источник дефолтов — playbook §2.1."
    >
      <AiModelsClient />
    </AdminSection>
  );
}
