import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google", () => ({
  getGoogleFreeBusy: vi.fn(async () => ({})),
}));

import { getGoogleFreeBusy } from "@/lib/google";

const originalEnv = { ...process.env };
const mockedFreeBusy = vi.mocked(getGoogleFreeBusy);
const FIXED_NOW = new Date("2025-01-01T16:00:00.000Z");

describe("slot generation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockedFreeBusy.mockReset();
    process.env = { ...originalEnv, TZ_DEFAULT_HOST: "America/Los_Angeles" };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it("generates mock availability in UTC", async () => {
    const { getMockSlotsByDate } = await import("@/lib/slots");

    const slotsByDate = getMockSlotsByDate("intro-30");
    const firstDaySlots = slotsByDate["2025-01-01"] ?? [];

    expect(firstDaySlots.length).toBeGreaterThan(0);
    expect(firstDaySlots.every((slot) => slot.start.endsWith("Z") && slot.end.endsWith("Z"))).toBe(true);
  });

  it("excludes FreeBusy conflicts", async () => {
    mockedFreeBusy.mockResolvedValueOnce({
      primary: [
        {
          start: "2025-01-01T18:00:00.000Z",
          end: "2025-01-01T18:30:00.000Z",
        },
      ],
    });

    const { getAvailabilityByDate } = await import("@/lib/slots");

    const availability = await getAvailabilityByDate("intro-30");
    const daySlots = availability["2025-01-01"] ?? [];

    expect(daySlots.some((slot) => slot.start === "2025-01-01T18:00:00.000Z")).toBe(false);
    expect(mockedFreeBusy).toHaveBeenCalledTimes(1);
  });

  it("returns fallback metadata when Google availability fails", async () => {
    mockedFreeBusy.mockRejectedValueOnce(new Error("Missing calendar configuration"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { getAvailabilityWithFallback, getMockSlotsByDate } = await import("@/lib/slots");

      const expectedSlots = getMockSlotsByDate("intro-30");
      const availability = await getAvailabilityWithFallback("intro-30");

      expect(availability.source).toBe("mock");
      expect(availability.fallback).toBe(true);
      expect(availability.slotsByDate).toEqual(expectedSlots);
      expect(availability.message).toContain("Missing calendar configuration");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns Google metadata when availability succeeds", async () => {
    const { getAvailabilityWithFallback } = await import("@/lib/slots");

    const availability = await getAvailabilityWithFallback("intro-30");

    expect(availability.source).toBe("google");
    expect(availability.fallback).toBe(false);
    expect(Object.keys(availability.slotsByDate).length).toBeGreaterThan(0);
  });
});

