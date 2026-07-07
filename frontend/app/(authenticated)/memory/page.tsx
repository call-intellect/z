import type { Metadata } from "next";

import { BranchMapClient } from "./BranchMapClient";

export const metadata: Metadata = {
  title: "Память",
};

export default function MemoryHubPage() {
  return <BranchMapClient />;
}
