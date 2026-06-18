import type { Metadata } from "next";

import { DomainsClient } from "./DomainsClient";

export const metadata: Metadata = {
  title: "Функциональные домены",
};

export default function DomainsPage() {
  return <DomainsClient />;
}
