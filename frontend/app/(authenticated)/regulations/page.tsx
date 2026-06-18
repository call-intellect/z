import type { Metadata } from "next";

import { SECTION_LABELS } from "@/lib/section-labels";

import { RegulationsListClient } from "./RegulationsListClient";

export const metadata: Metadata = {
  title: SECTION_LABELS.regulations,
};

export default function RegulationsPage() {
  return <RegulationsListClient />;
}
