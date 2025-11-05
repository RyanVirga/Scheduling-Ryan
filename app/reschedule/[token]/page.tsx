import Link from 'next/link';
import { headers } from 'next/headers';

import BookingClient from '@/app/book/[type]/BookingClient';
import { resolveAppBaseUrl } from '@/lib/url';
import type { AvailabilityByDate, MeetingType, UtcSlot } from '@/lib/slots';

export const revalidate = 0;

type ReschedulePageProps = {
  params: Promise<{ token: string }>;
};

type RescheduleSuccessResponse = {
  status: 'ok';
  meetingType: MeetingType;
  hostTimezone: string;
  slotsByDate: AvailabilityByDate;
  source: 'google' | 'mock';
  fallback: boolean;
  message?: string;
  currentSlot: UtcSlot | null;
  guest: { name?: string; email: string };
};

type RescheduleErrorResponse = {
  status:
    | 'invalid_token'
    | 'expired'
    | 'unknown_meeting_type'
    | 'google_error'
    | 'error';
  message: string;
};

type RescheduleApiResponse = RescheduleSuccessResponse | RescheduleErrorResponse;

async function fetchRescheduleData(token: string): Promise<{ payload: RescheduleApiResponse | null; statusCode: number }> {
  const headerList = await headers();
  const baseUrl = resolveAppBaseUrl(headerList);
  const endpoint = new URL('/api/reschedule', baseUrl);
  endpoint.searchParams.set('token', token);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
    });

    const payload = (await response.json().catch(() => null)) as RescheduleApiResponse | null;

    return {
      payload,
      statusCode: response.status,
    };
  } catch (error) {
    console.error('[reschedule-page] Failed to fetch reschedule data', error);
    return {
      payload: {
        status: 'error',
        message: 'We were unable to load the reschedule details. Please try again later.',
      },
      statusCode: 500,
    };
  }
}

function resolveErrorCopy(response: RescheduleErrorResponse, statusCode: number) {
  switch (response.status) {
    case 'expired':
      return {
        badge: 'Expired',
        title: 'This link has expired',
        description:
          response.message ??
          'Reschedule links are only valid for a limited time. Reach out to the host for a fresh link.',
        tone: 'warning' as const,
      };
    case 'invalid_token':
      return {
        badge: 'Invalid',
        title: 'Reschedule link is invalid',
        description:
          response.message ??
          'The link appears to be malformed. Double-check the URL or ask the host for a new message.',
        tone: 'error' as const,
      };
    case 'unknown_meeting_type':
      return {
        badge: 'Unavailable',
        title: 'Meeting type not available',
        description:
          response.message ??
          'The meeting type tied to this link is no longer active. Contact the host for assistance.',
        tone: 'warning' as const,
      };
    case 'google_error':
      return {
        badge: 'Calendar Error',
        title: 'We could not reach Google Calendar',
        description:
          response.message ??
          'Google Calendar returned an error while loading this reschedule link. Please try again shortly.',
        tone: 'error' as const,
      };
    default:
      return {
        badge: statusCode >= 500 ? 'Server Error' : 'Error',
        title: 'Something went wrong',
        description:
          response.message ??
          'We ran into an unexpected issue while processing your reschedule request. Please try again soon.',
        tone: 'error' as const,
      };
  }
}

function renderError(response: RescheduleErrorResponse, statusCode: number) {
  const copy = resolveErrorCopy(response, statusCode);

  const badgeStyles: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    error: 'bg-red-100 text-red-700 border-red-200',
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-10 px-6 text-center">
      <div className="space-y-5 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-10 shadow-[var(--shadow-soft)]">
        <span
          className={`inline-flex items-center justify-center rounded-full border px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${badgeStyles[copy.tone]}`}
        >
          {copy.badge}
        </span>
        <h1 className="text-3xl font-semibold text-slate-900">{copy.title}</h1>
        <p className="text-pretty text-slate-600">{copy.description}</p>

        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-sky-600 px-6 py-2 text-sm font-semibold text-white shadow transition hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Back to scheduler
          </Link>
          <a
            href="mailto:hello@craftamplify.com"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Contact the host
          </a>
        </div>
      </div>
    </main>
  );
}

export default async function ReschedulePage({ params }: ReschedulePageProps) {
  const { token } = await params;
  const { payload, statusCode } = await fetchRescheduleData(token);

  if (!payload) {
    return renderError(
      {
        status: 'error',
        message: 'We were unable to load this reschedule link. Please try again later.',
      },
      statusCode,
    );
  }

  if (payload.status !== 'ok') {
    return renderError(payload, statusCode);
  }

  return (
    <BookingClient
      meetingType={payload.meetingType}
      slotsByDate={payload.slotsByDate}
      hostTimezone={payload.hostTimezone}
      initialSource={payload.source}
      initialFallback={payload.fallback}
      mode="reschedule"
      rescheduleToken={token}
      existingSlot={payload.currentSlot}
      guestInfo={payload.guest}
    />
  );
}

