import type { Metadata } from "next";

import { MemoryAccessClient } from "./MemoryAccessClient";

export const metadata: Metadata = {
  title: "Доступ к памяти компании",
};

export default function MemoryAccessPage() {
  return <MemoryAccessClient />;
}
