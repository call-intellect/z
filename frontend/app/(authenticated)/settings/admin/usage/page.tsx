import { redirect } from "next/navigation";

export default function OrgUsageRedirectPage(): never {
  redirect("/company-admin");
}
