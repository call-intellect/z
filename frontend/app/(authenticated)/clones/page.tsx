import type { Metadata } from "next";

import { ClonesMarketplaceClient } from "./ClonesMarketplaceClient";

export const metadata: Metadata = {
  title: "Клоны должностей",
};

export default function ClonesPage() {
  return <ClonesMarketplaceClient />;
}
