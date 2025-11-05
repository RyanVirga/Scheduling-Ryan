import { NextResponse } from "next/server";

import { getGoogleHealth } from "@/lib/google";

export async function GET() {
  const health = await getGoogleHealth();
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 503 : 502;

  return NextResponse.json(health, { status: statusCode });
}

