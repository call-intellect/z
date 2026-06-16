import { permanentRedirect } from "next/navigation";

export default function ExpiringRecordingsRedirectPage() {
  permanentRedirect("/admin/media/expiring");
}
