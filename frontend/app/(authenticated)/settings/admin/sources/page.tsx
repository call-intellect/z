import { redirect } from "next/navigation";

export default function SettingsAdminSourcesRedirect(): never {
  redirect("/company-admin/sources");
}
