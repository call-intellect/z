import type { Metadata } from "next";

import { SECTION_LABELS } from "@/lib/section-labels";

import { StructureClient } from "./StructureClient";

export const metadata: Metadata = {
  title: SECTION_LABELS.structure,
};

export default function StructurePage() {
  return <StructureClient />;
}
