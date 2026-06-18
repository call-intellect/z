import { permanentRedirect } from "next/navigation";

export default function AdminAiUsageLegacyPage(): never {
  permanentRedirect("/admin/analytics/functions");
}
