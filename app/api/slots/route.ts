import { NextResponse } from "next/server";

import { HOST_TIMEZONE, getAvailabilityWithFallback } from "@/lib/slots";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const meetingTypeId = searchParams.get("meetingTypeId") ?? "intro-30";
  const date = searchParams.get("date");
  const availability = await getAvailabilityWithFallback(meetingTypeId);
  const slots = date
    ? availability.slotsByDate[date] ?? []
    : availability.slotsByDate;

  return NextResponse.json({
    meetingTypeId,
    hostTimezone: HOST_TIMEZONE,
    date,
    slots,
    source: availability.source,
    fallback: availability.fallback,
    ...(availability.fallback && availability.message
      ? { message: availability.message }
      : {}),
  });
}

