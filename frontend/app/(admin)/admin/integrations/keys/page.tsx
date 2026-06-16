import { redirect } from "next/navigation";

export default function AdminIntegrationsKeysRedirect(): never {
  redirect("/admin/integration-keys");
}
