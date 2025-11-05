import { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  HOST_TIMEZONE,
  MeetingType,
  getMeetingTypeById,
  getAvailabilityWithFallback,
} from "@/lib/slots";

import BookingClient from "./BookingClient";

type BookPageProps = {
  params: Promise<{ type: string }>;
};

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const { type } = await params;
  const meetingType = getMeetingTypeById(type);

  if (!meetingType) {
    return {
      title: "Meeting type not found",
    };
  }

  return {
    title: `${meetingType.title} | Ryan's Personal Scheduler`,
    description: `Choose a time for ${meetingType.title}. Slots are shown in your timezone once selected.`,
  };
}

export default async function BookTypePage({ params }: BookPageProps) {
  const { type } = await params;
  const meetingType = getMeetingTypeById(type);

  if (!meetingType) {
    notFound();
  }

  const availability = await getAvailabilityWithFallback(meetingType.id);

  return (
    <BookingClient
      meetingType={meetingType as MeetingType}
      slotsByDate={availability.slotsByDate}
      hostTimezone={HOST_TIMEZONE}
      initialSource={availability.source}
      initialFallback={availability.fallback}
    />
  );
}

