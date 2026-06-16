import { redirect } from "next/navigation";

export default function MyContributionsRedirectPage() {
  redirect("/me?tab=contributions");
}
