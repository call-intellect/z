import { redirect } from "next/navigation";

export default function SettingsSourcesRedirectPage(): never {
  redirect("/company-admin/sources");
}
