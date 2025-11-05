import Link from 'next/link';
import type { ReactNode } from 'react';
import { format } from 'date-fns';

import { formatSlotLabel, type ManageErrorResponse, type ManageSuccessResponse } from './shared';

type CopyTone = 'success' | 'warning' | 'error';

type ErrorCopy = {
  badge: string;
  title: string;
  description: string;
  tone: CopyTone;
};

const badgeStyles: Record<CopyTone, string> = {
  success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  error: 'bg-red-100 text-red-700 border-red-200',
};

function resolveErrorCopy(response: ManageErrorResponse, statusCode: number): ErrorCopy {
  switch (response.status) {
    case 'expired':
      return {
        badge: 'Expired',
        title: 'This link has expired',
        description:
          response.message ??
          'Manage links are only valid for a limited time. Reach out to the host if you still need to make a change.',
        tone: 'warning',
      };
    case 'unknown_meeting_type':
      return {
        badge: 'Unavailable',
        title: 'Meeting type not available',
        description:
          response.message ??
          'The meeting type for this link is no longer active. Contact the host for assistance.',
        tone: 'warning',
      };
    case 'invalid_token':
      return {
        badge: 'Invalid',
        title: 'Management link is invalid',
        description:
          response.message ??
          'The link appears to be malformed. Double-check the URL or contact the host for help.',
        tone: 'error',
      };
    default:
      return {
        badge: statusCode >= 500 ? 'Server Error' : 'Error',
        title: 'Something went wrong',
        description:
          response.message ??
          'We ran into an unexpected issue while loading your meeting details. Please try again shortly.',
        tone: 'error',
      };
  }
}

type ManagementErrorProps = {
  response: ManageErrorResponse;
  statusCode: number;
};

export function ManagementError({ response, statusCode }: ManagementErrorProps) {
  const copy = resolveErrorCopy(response, statusCode);

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

type ManagementDetailsProps = {
  payload: ManageSuccessResponse;
  badgeText: string;
  heading: string;
  description: ReactNode;
  badgeTone?: CopyTone;
  showHelp?: boolean;
};

export function ManagementDetails({
  payload,
  badgeText,
  heading,
  description,
  badgeTone = 'success',
  showHelp = true,
}: ManagementDetailsProps) {
  const slotLabel = formatSlotLabel(payload.currentSlot, payload.hostTimezone);
  const expiresAt = payload.managementLinks.manage.expiresAt;

  return (
    <div className="w-full space-y-6 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-10 shadow-[var(--shadow-soft)]">
      <span
        className={`inline-flex items-center justify-center rounded-full border px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${badgeStyles[badgeTone]}`}
      >
        {badgeText}
      </span>
      <h1 className="text-3xl font-semibold text-slate-900">{heading}</h1>
      <p className="text-pretty text-slate-600">{description}</p>

      <div className="grid gap-6 rounded-[var(--radius-md)] border border-slate-100 bg-slate-50/70 p-6 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Meeting</p>
          <p className="text-lg font-semibold text-slate-900">{payload.meetingType.title}</p>
          <p className="text-sm text-slate-500">Hosted in {payload.hostTimezone}</p>
          {slotLabel ? <p className="text-sm text-slate-600">Currently scheduled for {slotLabel}</p> : null}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Guest</p>
          <p className="text-lg font-semibold text-slate-900">{payload.guest.name ?? 'Guest'}</p>
          <p className="text-sm text-slate-600">{payload.guest.email}</p>
          {expiresAt ? (
            <p className="text-xs text-slate-500">
              Manage link valid until {format(new Date(expiresAt), 'MMM d, yyyy h:mm a')}.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row">
        <Link
          href={payload.managementLinks.reschedule.path}
          className="inline-flex flex-1 items-center justify-center rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow transition hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          Reschedule meeting
        </Link>
        <Link
          href={payload.managementLinks.cancel.path}
          className="inline-flex flex-1 items-center justify-center rounded-full border border-red-200 px-6 py-3 text-sm font-semibold text-red-600 transition hover:border-red-300 hover:text-red-700"
        >
          Cancel meeting
        </Link>
      </div>

      {showHelp ? (
        <div className="rounded-[var(--radius-md)] border border-slate-100 bg-white p-5 text-sm text-slate-600">
          <p className="font-semibold text-slate-700">Need more help?</p>
          <p className="mt-1">
            Email <a className="text-sky-600 underline" href="mailto:hello@craftamplify.com">hello@craftamplify.com</a>{' '}
            and we&apos;ll make sure your meeting is updated.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export const managementBadgeStyles = badgeStyles;

