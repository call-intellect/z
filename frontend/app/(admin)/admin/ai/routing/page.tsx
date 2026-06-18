import type { Metadata } from "next";

import { RoutingClient } from "./RoutingClient";

export const metadata: Metadata = {
  title: "Роутинг моделей",
};

export default function AdminAiRoutingPage() {
  return <RoutingClient />;
}
