import { NextResponse } from "next/server";

import { listServerAuthFiles } from "@/lib/quota/server-auth-files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // listServerAuthFiles keeps credentials in its server-only rawFiles field;
    // this route deliberately serializes only the sanitized card metadata.
    const { files } = await listServerAuthFiles();
    return NextResponse.json(
      { files },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error) {
    console.error("Failed to serve auth files", error);
    return NextResponse.json(
      { error: "Backend request failed" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }
}
