import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = process.env.API_BASE_URL || "";
const API_MANAGEMENT_KEY = process.env.API_MANAGEMENT_KEY || "";

export async function POST(request: NextRequest) {
  if (!API_BASE_URL || !API_MANAGEMENT_KEY) {
    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/api-call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_MANAGEMENT_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `Backend error: ${response.status} ${text}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
