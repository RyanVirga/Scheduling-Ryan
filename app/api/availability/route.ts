import { NextResponse } from "next/server";

import { HOST_TIMEZONE, getAvailabilityWithFallback } from "@/lib/slots";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const meetingTypeId = searchParams.get("meetingTypeId") ?? "intro-30";
  const availability = await getAvailabilityWithFallback(meetingTypeId);

  const days = Object.entries(availability.slotsByDate).map(([date, slots]) => ({
    date,
    hasAvailability: slots.length > 0,
    totalSlots: slots.length,
  }));

  return NextResponse.json({
    meetingTypeId,
    hostTimezone: HOST_TIMEZONE,
    days,
    source: availability.source,
    fallback: availability.fallback,
    ...(availability.fallback && availability.message
      ? { message: availability.message }
      : {}),
  });
}

