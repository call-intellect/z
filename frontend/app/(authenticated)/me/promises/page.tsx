import { redirect } from "next/navigation";

export default function MyPromisesRedirectPage() {
  redirect("/me?tab=promises");
}
