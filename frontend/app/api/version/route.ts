const BOOT_VERSION =
  process.env.BUILD_HASH ?? Date.now().toString(36);

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ version: BOOT_VERSION });
}
