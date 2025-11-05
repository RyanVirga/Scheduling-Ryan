import Link from 'next/link';
import { headers } from 'next/headers';

import { fetchManageData } from '../manage/shared';
import { ManagementDetails, ManagementError, managementBadgeStyles } from '../manage/components';

export const revalidate = 0;

type ConfirmPageProps = {
  searchParams?: { token?: string };
};

export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const token = searchParams?.token;

  if (!token) {
    return (
      <ManagementError
        response={{
          status: 'error',
          message: 'We could not find a confirmation token. Use the manage link from your email.',
        }}
        statusCode={400}
      />
    );
  }

  const headerList = await headers();
  const { payload, statusCode } = await fetchManageData(token, headerList);

  if (!payload) {
    return (
      <ManagementError
        response={{
          status: 'error',
          message: 'We were unable to load your confirmation details. Please try again later.',
        }}
        statusCode={statusCode}
      />
    );
  }

  if (payload.status !== 'ok') {
    return <ManagementError response={payload} statusCode={statusCode} />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center gap-10 px-6 py-16">
      <div className="w-full space-y-5 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-10 text-center shadow-[var(--shadow-soft)]">
        <span
          className={`inline-flex items-center justify-center rounded-full border px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${managementBadgeStyles.success}`}
        >
          Booking confirmed
        </span>
        <h1 className="text-3xl font-semibold text-slate-900">See you soon!</h1>
        <p className="text-pretty text-slate-600">
          You&apos;re all set. We&apos;ll email the calendar invite and you can manage the meeting any time using the buttons below.
        </p>
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
          <Link
            href={payload.managementLinks.manage.path}
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Manage meeting
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Book another time
          </Link>
        </div>
      </div>

      <ManagementDetails
        payload={payload}
        badgeText="Meeting details"
        heading="Here&apos;s what we scheduled"
        description="Review your meeting info or use the quick actions below to reschedule or cancel."
      />
    </main>
  );
}

