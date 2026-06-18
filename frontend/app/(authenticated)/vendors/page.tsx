import type { Metadata } from "next";

import { VendorsListClient } from "./VendorsListClient";

export const metadata: Metadata = {
  title: "Поставщики",
};

export default function VendorsPage() {
  return <VendorsListClient />;
}
