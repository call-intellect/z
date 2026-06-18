import { permanentRedirect } from "next/navigation";

export default function AdminMeetingsRedirectPage() {
  permanentRedirect("/admin/media/meetings");
}
