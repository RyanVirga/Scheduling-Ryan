import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

import { resolveAppBaseUrl, type HeaderSource } from '@/lib/url';
import type { ManagementLinkCollection } from '@/lib/sign';
import type { MeetingType } from '@/lib/slots';

export type ManagePageProps = {
  params: Promise<{ token: string }>;
};

export type ManageSuccessResponse = {
  status: 'ok';
  meetingType: MeetingType;
  hostTimezone: string;
  currentSlot: { start: string; end: string } | null;
  guest: { name?: string; email: string };
  calendarId: string;
  managementLinks: ManagementLinkCollection;
};

export type ManageErrorStatus = 'invalid_token' | 'expired' | 'unknown_meeting_type' | 'error';

export type ManageErrorResponse = {
  status: ManageErrorStatus;
  message: string;
};

export type ManageApiResponse = ManageSuccessResponse | ManageErrorResponse;

export type ManageFetchResult = {
  payload: ManageApiResponse | null;
  statusCode: number;
};

export async function fetchManageData(
  token: string,
  headerSource?: Request | HeaderSource,
): Promise<ManageFetchResult> {
  const baseUrl = resolveAppBaseUrl(headerSource);
  const endpoint = new URL('/api/manage', `${baseUrl}/`);
  endpoint.searchParams.set('token', token);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
    });

    const payload = (await response.json().catch(() => null)) as ManageApiResponse | null;

    return {
      payload,
      statusCode: response.status,
    };
  } catch (error) {
    console.error('[manage-shared] Failed to fetch manage data', error);
    return {
      payload: {
        status: 'error',
        message: 'We were unable to load management details. Please try again later.',
      },
      statusCode: 500,
    };
  }
}

export function formatSlotLabel(slot: { start: string; end: string } | null, timezone: string) {
  if (!slot) {
    return null;
  }

  const start = toZonedTime(new Date(slot.start), timezone);
  const end = toZonedTime(new Date(slot.end), timezone);

  return `${format(start, 'EEEE, MMMM d, h:mm a')} – ${format(end, 'h:mm a')} (${timezone})`;
}

