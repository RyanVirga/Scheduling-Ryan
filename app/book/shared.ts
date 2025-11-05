import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import type { AvailabilityByDate, UtcSlot } from "@/lib/slots";

export function cloneAvailabilityMap(source: AvailabilityByDate): AvailabilityByDate {
  return Object.fromEntries(
    Object.entries(source).map(([date, slots]) => [
      date,
      slots.map((slot) => ({ ...slot })),
    ]),
  );
}

export function createDateFromLabel(label: string): Date {
  const [year, month, day] = label.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatSlotRange(slot: UtcSlot, timezone: string): string {
  const startGuest = toZonedTime(new Date(slot.start), timezone);
  const endGuest = toZonedTime(new Date(slot.end), timezone);
  return `${format(startGuest, "h:mm a")} - ${format(endGuest, "h:mm a")}`;
}

