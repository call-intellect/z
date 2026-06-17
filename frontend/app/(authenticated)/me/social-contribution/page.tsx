import { redirect } from "next/navigation";

export default function MySocialContributionRedirectPage() {
  redirect("/me?tab=social");
}
