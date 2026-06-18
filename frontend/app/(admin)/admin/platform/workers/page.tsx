import type { Metadata } from "next";

import { WorkersClient } from "./WorkersClient";

export const metadata: Metadata = {
  title: "BullMQ воркеры",
};

export default function AdminPlatformWorkersPage() {
  return <WorkersClient />;
}
