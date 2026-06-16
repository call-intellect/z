import type { Metadata } from "next";

import { EntitiesListClient } from "./EntitiesListClient";

export const metadata: Metadata = {
  title: "Сущности",
};

export default function EntitiesPage() {
  return <EntitiesListClient />;
}
