"use client";

import {
  Boxes,
  Database,
  DatabaseZap,
  HardDrive,
  ListTree,
  Video,
} from "lucide-react";

import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminTabs, type AdminTabDef } from "@/ui/components/admin/AdminTabs";

import { HealthDbTab } from "./HealthDbTab";
import { HealthEmbeddingsTab } from "./HealthEmbeddingsTab";
import { HealthLivekitTab } from "./HealthLivekitTab";
import { HealthQueuesTab } from "./HealthQueuesTab";
import { HealthS3Tab } from "./HealthS3Tab";
import { HealthWorkersTab } from "./HealthWorkersTab";
import { adminRootCrumb } from "@/ui/components/admin/brand";

const TABS: AdminTabDef[] = [
  { value: "queues", label: "Очереди", icon: ListTree },
  { value: "db", label: "БД", icon: Database },
  { value: "embeddings", label: "Эмбеддинги", icon: DatabaseZap },
  { value: "workers", label: "Воркеры", icon: Boxes },
  { value: "s3", label: "S3", icon: HardDrive },
  { value: "livekit", label: "LiveKit", icon: Video },
];

export function HealthClient() {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Пульс", href: "/admin" },
        { label: "Здоровье системы" },
      ]}
      title="Здоровье системы"
      description="Очереди, БД, эмбеддинги, воркеры, S3 и LiveKit — каждая часть инфраструктуры на отдельной вкладке."
    >
      <AdminTabs tabs={TABS} defaultTab="queues">
        {(active) => (
          <>
            {active === "queues" && <HealthQueuesTab />}
            {active === "db" && <HealthDbTab />}
            {active === "embeddings" && <HealthEmbeddingsTab />}
            {active === "workers" && <HealthWorkersTab />}
            {active === "s3" && <HealthS3Tab />}
            {active === "livekit" && <HealthLivekitTab />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}
