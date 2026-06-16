import { redirect } from "next/navigation";

export default function MyPulseRedirectPage() {
  redirect("/me?tab=pulse");
}
