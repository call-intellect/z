import type { Metadata } from "next";

import { CustomersListClient } from "./CustomersListClient";

export const metadata: Metadata = {
  title: "Клиенты",
};

export default function CustomersPage() {
  return <CustomersListClient />;
}
