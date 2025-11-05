import { addDays, addMinutes, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import appSettings from "@/config/app.settings.json" assert { type: "json" };
import availabilityRules from "@/config/availability.rules.json" assert { type: "json" };
import meetingTypes from "@/config/meeting_types.json" assert { type: "json" };
import { getGoogleFreeBusy, type GoogleFreeBusyResult } from "@/lib/google";

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ENV_HOST_TIMEZONE = process.env.TZ_DEFAULT_HOST ?? process.env.HOST_TIMEZONE;

export const HOST_TIMEZONE = ENV_HOST_TIMEZONE ?? appSettings.hostTimezone ?? "America/Los_Angeles";

export const GUEST_TIMEZONE_OPTIONS = [
  { label: "Eastern Time (ET)", value: "America/New_York" },
  { label: "Central Time (CT)", value: "America/Chicago" },
  { label: "Mountain Time (MT)", value: "America/Denver" },
  { label: "Pacific Time (PT)", value: "America/Los_Angeles" },
];

type AvailabilityRule = (typeof availabilityRules)[number];

export type MeetingType = {
  id: string;
  title: string;
  description?: string;
  durationMinutes: number;
  isActive: boolean;
};

export type UtcSlot = {
  start: string;
  end: string;
};

export type AvailabilityByDate = Record<string, UtcSlot[]>;

export type AvailabilityResolution = {
  slotsByDate: AvailabilityByDate;
  source: "google" | "mock";
  fallback: boolean;
  message?: string;
};

type BusyInterval = {
  start: Date;
  end: Date;
};

const BLOCKED_MOCK_SLOTS = createBlockedMockSlots();

export function getMeetingTypes(): MeetingType[] {
  return meetingTypes as MeetingType[];
}

export function getActiveMeetingTypes(): MeetingType[] {
  return getMeetingTypes().filter((type) => type.isActive);
}

export function getMeetingTypeById(id: string): MeetingType | undefined {
  return getMeetingTypes().find((type) => type.id === id);
}

export function getMockSlotsByDate(meetingTypeId: string): AvailabilityByDate {
  const meetingType = getMeetingTypeById(meetingTypeId);
  if (!meetingType) {
    return {};
  }

  const nowUtc = new Date();
  const { startDateUtc } = getAvailabilityWindow(nowUtc);
  const busyIntervals = getMockBusyIntervals(meetingType.durationMinutes);

  return buildAvailabilityCalendar({
    meetingType,
    startDateUtc,
    nowUtc,
    busyIntervals,
  });
}

export async function getAvailabilityByDate(meetingTypeId: string): Promise<AvailabilityByDate> {
  const meetingType = getMeetingTypeById(meetingTypeId);
  if (!meetingType) {
    return {};
  }

  const nowUtc = new Date();
  const { startDateUtc, endDateUtc } = getAvailabilityWindow(nowUtc);

  const freeBusy = await getGoogleFreeBusy({
    timeMin: startDateUtc,
    timeMax: endDateUtc,
  });

  const busyIntervals = collectBusyIntervals(freeBusy);

  return buildAvailabilityCalendar({
    meetingType,
    startDateUtc,
    nowUtc,
    busyIntervals,
  });
}

export async function getAvailabilityWithFallback(meetingTypeId: string): Promise<AvailabilityResolution> {
  const meetingType = getMeetingTypeById(meetingTypeId);

  if (!meetingType) {
    return {
      slotsByDate: {},
      source: "mock",
      fallback: true,
      message: `Meeting type ${meetingTypeId} is not configured.`,
    };
  }

  try {
    const slotsByDate = await getAvailabilityByDate(meetingType.id);

    return {
      slotsByDate,
      source: "google",
      fallback: false,
    };
  } catch (error) {
    const fallbackSlots = getMockSlotsByDate(meetingType.id);
    const message =
      error instanceof Error ? error.message : "Unknown error fetching Google availability";

    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[availability] Falling back to mock data for ${meetingType.id}: ${message}`,
      );
    }

    return {
      slotsByDate: fallbackSlots,
      source: "mock",
      fallback: true,
      message,
    };
  }
}

function buildAvailabilityCalendar({
  meetingType,
  startDateUtc,
  nowUtc,
  busyIntervals,
}: {
  meetingType: MeetingType;
  startDateUtc: Date;
  nowUtc: Date;
  busyIntervals: BusyInterval[];
}): AvailabilityByDate {
  const availability: AvailabilityByDate = {};

  for (let offset = 0; offset <= appSettings.maxDaysOut; offset++) {
    const dayStartUtc = addDays(startDateUtc, offset);
    const dayInHostTz = toZonedTime(dayStartUtc, HOST_TIMEZONE);
    const dateLabel = format(dayInHostTz, "yyyy-MM-dd");
    const nextDayStartUtc = addDays(dayStartUtc, 1);

    const busyForDay = busyIntervals.filter(
      (interval) => interval.start < nextDayStartUtc && interval.end > dayStartUtc,
    );

    availability[dateLabel] = buildSlotsForDate({
      meetingType,
      dateLabel,
      nowUtc,
      busyIntervals: busyForDay,
    });
  }

  return availability;
}

function buildSlotsForDate({
  meetingType,
  dateLabel,
  nowUtc,
  busyIntervals,
}: {
  meetingType: MeetingType;
  dateLabel: string;
  nowUtc: Date;
  busyIntervals: BusyInterval[];
}): UtcSlot[] {
  const rule = getRuleForDate(dateLabel);

  if (!rule) {
    return [];
  }

  const startUtc = fromZonedTime(`${dateLabel}T${rule.start}:00`, HOST_TIMEZONE);
  const endUtc = fromZonedTime(`${dateLabel}T${rule.end}:00`, HOST_TIMEZONE);

  const slots: UtcSlot[] = [];
  let cursor = startUtc;
  const minStartUtc = addMinutes(nowUtc, appSettings.minNoticeMinutes);

  while (cursor < endUtc) {
    const slotEnd = addMinutes(cursor, meetingType.durationMinutes);
    if (slotEnd > endUtc) break;

    if (cursor >= minStartUtc) {
      const cursorInHost = toZonedTime(cursor, HOST_TIMEZONE);
      const isLunchBreak = cursorInHost.getHours() === 12;

      if (!isLunchBreak && !slotOverlapsBusy(cursor, slotEnd, busyIntervals)) {
        slots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
      }
    }

    cursor = slotEnd;
  }

  return slots;
}

function slotOverlapsBusy(startUtc: Date, endUtc: Date, busyIntervals: BusyInterval[]) {
  return busyIntervals.some((interval) => startUtc < interval.end && endUtc > interval.start);
}

function getRuleForDate(dateLabel: string): AvailabilityRule | undefined {
  const midnightUtc = fromZonedTime(`${dateLabel}T00:00:00`, HOST_TIMEZONE);
  const hostDate = toZonedTime(midnightUtc, HOST_TIMEZONE);
  const weekdayIndex = hostDate.getDay();

  return (availabilityRules as AvailabilityRule[]).find(
    (rule) => WEEKDAY_INDEX[rule.weekday] === weekdayIndex,
  );
}

function collectBusyIntervals(freeBusy: GoogleFreeBusyResult): BusyInterval[] {
  const intervals: BusyInterval[] = [];

  for (const calendarBusy of Object.values(freeBusy)) {
    for (const range of calendarBusy) {
      const start = new Date(range.start);
      const end = new Date(range.end);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        continue;
      }

      intervals.push({ start, end });
    }
  }

  return mergeBusyIntervals(intervals);
}

function mergeBusyIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = intervals
    .map((interval) => ({
      start: new Date(interval.start.getTime()),
      end: new Date(interval.end.getTime()),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: BusyInterval[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end) {
      if (current.end > previous.end) {
        previous.end = current.end;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function getMockBusyIntervals(durationMinutes: number): BusyInterval[] {
  const busy: BusyInterval[] = [];

  for (const [dateLabel, blockedStarts] of Object.entries(BLOCKED_MOCK_SLOTS)) {
    for (const startLabel of blockedStarts) {
      const startUtc = fromZonedTime(`${dateLabel}T${startLabel}:00`, HOST_TIMEZONE);
      const endUtc = addMinutes(startUtc, durationMinutes);
      busy.push({ start: startUtc, end: endUtc });
    }
  }

  return busy;
}

function getAvailabilityWindow(nowUtc: Date): { startDateUtc: Date; endDateUtc: Date } {
  const hostNow = toZonedTime(nowUtc, HOST_TIMEZONE);
  const startLabel = format(hostNow, "yyyy-MM-dd");
  const startDateUtc = fromZonedTime(`${startLabel}T00:00:00`, HOST_TIMEZONE);

  const lastHostDate = addDays(hostNow, appSettings.maxDaysOut);
  const lastLabel = format(lastHostDate, "yyyy-MM-dd");
  const lastDayStartUtc = fromZonedTime(`${lastLabel}T00:00:00`, HOST_TIMEZONE);
  const endDateUtc = addDays(lastDayStartUtc, 1);

  return { startDateUtc, endDateUtc };
}

function createBlockedMockSlots(): Record<string, string[]> {
  const hostNow = toZonedTime(new Date(), HOST_TIMEZONE);
  const first = format(addDays(hostNow, 2), "yyyy-MM-dd");
  const second = format(addDays(hostNow, 9), "yyyy-MM-dd");

  return {
    [first]: ["09:00", "09:30", "10:00"],
    [second]: ["13:00", "13:30"],
  };
}

