import type { Metadata } from "next";

import { BitrixIntegrationClient } from "../../../settings/integrations/BitrixIntegrationClient";

export const metadata: Metadata = {
  title: "Источник: Bitrix24",
};

export default function CompanyAdminBitrixSourcePage() {
  return <BitrixIntegrationClient />;
}
