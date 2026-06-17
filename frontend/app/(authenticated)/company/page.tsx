import type { Metadata } from "next";

import { CompanyClient } from "./CompanyClient";

export const metadata: Metadata = {
  title: "Компания",
};

export default function CompanyPage() {
  return <CompanyClient />;
}
