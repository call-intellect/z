import { redirect } from "next/navigation";

export default function MeetingsAdminRedirectPage(): never {
  redirect("/company-admin/meetings");
}
