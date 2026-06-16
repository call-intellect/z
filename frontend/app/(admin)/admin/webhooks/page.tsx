import { redirect } from "next/navigation";

export default function LegacyAdminWebhooksRedirect(): never {
  redirect("/admin/integrations/webhooks");
}
