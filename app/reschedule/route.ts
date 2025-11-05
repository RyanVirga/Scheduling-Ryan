import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      status: "not-implemented",
      message: "Reschedule links will fetch updated slots and amend Google Calendar events in a later phase.",
    },
    { status: 501 },
  );
}

