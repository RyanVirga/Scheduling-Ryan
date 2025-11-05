'use client';

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  AvailabilityByDate,
  GUEST_TIMEZONE_OPTIONS,
  MeetingType,
  UtcSlot,
} from '@/lib/slots';
import { cloneAvailabilityMap, createDateFromLabel, formatSlotRange } from '../shared';
import { LegendDot, SummaryRow } from '../shared-ui';

type BookingClientProps = {
  meetingType: MeetingType;
  slotsByDate: AvailabilityByDate;
  hostTimezone: string;
  initialSource: 'google' | 'mock';
  initialFallback: boolean;
  mode?: 'book' | 'reschedule';
  rescheduleToken?: string;
  existingSlot?: UtcSlot | null;
  guestInfo?: {
    name?: string;
    email: string;
  } | null;
};

const bookingFormSchema = z.object({
  guestName: z.string().min(1, 'Name is required'),
  guestEmail: z.string().email('Enter a valid email address'),
});

type BookingFormValues = z.infer<typeof bookingFormSchema>;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ManageLink = {
  token: string;
  path: string;
  url: string;
  expiresAt: string;
};

type ManagementLinks = {
  cancel: ManageLink;
  reschedule: ManageLink;
  manage: ManageLink;
};

type SubmitStatus =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
      status: 'success';
      eventLink?: string;
      videoLink?: string;
      updatedSlot?: UtcSlot;
      manageLinks?: ManagementLinks;
    }
  | { status: 'error'; message: string };

type RefreshStatus =
  | { status: 'idle' }
  | { status: 'refreshing' }
  | { status: 'error'; message: string };

type DataSourceState = {
  source: 'google' | 'mock';
  fallback: boolean;
};

export default function BookingClient({
  meetingType,
  slotsByDate,
  hostTimezone,
  initialSource,
  initialFallback,
  mode = 'book',
  rescheduleToken,
  existingSlot = null,
  guestInfo = null,
}: BookingClientProps) {
  const router = useRouter();
  const isReschedule = mode === 'reschedule';
  const [availability, setAvailability] = useState<AvailabilityByDate>(() => cloneAvailabilityMap(slotsByDate));
  const [dataSource, setDataSource] = useState<DataSourceState>({ source: initialSource, fallback: initialFallback });
  const [refreshState, setRefreshState] = useState<RefreshStatus>({ status: 'idle' });
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ status: 'idle' });
  const [currentBooking, setCurrentBooking] = useState<UtcSlot | null>(existingSlot);

  const currentBookingStart = currentBooking?.start ?? null;
  const defaultGuestName = guestInfo?.name ?? '';
  const defaultGuestEmail = guestInfo?.email ?? '';

  useEffect(() => {
    if (!isReschedule || !currentBookingStart) {
      return;
    }

    setAvailability((prev) => {
      const dateKey = currentBookingStart.slice(0, 10);
      const slots = prev[dateKey] ?? [];

      if (!slots.some((slot) => slot.start === currentBookingStart)) {
        return prev;
      }

      return {
        ...prev,
        [dateKey]: slots.filter((slot) => slot.start !== currentBookingStart),
      };
    });
  }, [isReschedule, currentBookingStart]);

  const sortedDates = useMemo(() => Object.keys(availability).sort(), [availability]);
  const firstAvailable = useMemo(
    () => sortedDates.find((date) => (availability[date] ?? []).length > 0),
    [sortedDates, availability],
  );
  const hostFallbackDate = useMemo(() => {
    const hostNow = toZonedTime(new Date(), hostTimezone);
    return format(hostNow, 'yyyy-MM-dd');
  }, [hostTimezone]);

  const initialDate = firstAvailable ?? sortedDates[0] ?? hostFallbackDate;
  const initialMonthDate = createDateFromLabel(initialDate);
  const minMonth = startOfMonth(createDateFromLabel(sortedDates[0] ?? initialDate));
  const maxMonth = startOfMonth(
    createDateFromLabel(sortedDates[sortedDates.length - 1] ?? initialDate),
  );

  const [guestTimezone, setGuestTimezone] = useState<string>(GUEST_TIMEZONE_OPTIONS[0].value);
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(initialMonthDate));
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedSlotStart, setSelectedSlotStart] = useState<string | null>(null);

  const resetSubmissionFeedback = () => {
    setSubmitStatus((prev) => (prev.status === 'submitting' ? prev : { status: 'idle' }));
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    mode: 'onChange',
    defaultValues: {
      guestName: defaultGuestName,
      guestEmail: defaultGuestEmail,
    },
  });

  const slotsForSelectedDate = useMemo(() => {
    const slots = availability[selectedDate] ?? [];
    if (!isReschedule || !currentBookingStart) {
      return slots;
    }
    return slots.filter((slot) => slot.start !== currentBookingStart);
  }, [availability, selectedDate, isReschedule, currentBookingStart]);
  const selectedSlot = useMemo(() => {
    return slotsForSelectedDate.find((slot) => slot.start === selectedSlotStart) ?? null;
  }, [selectedSlotStart, slotsForSelectedDate]);

  const currentBookingGuestLabel = useMemo(() => {
    if (!currentBooking) {
      return null;
    }

    return formatSlotRange(currentBooking, guestTimezone);
  }, [currentBooking, guestTimezone]);

  const currentBookingHostLabel = useMemo(() => {
    if (!currentBooking) {
      return null;
    }

    const startHost = toZonedTime(new Date(currentBooking.start), hostTimezone);
    const endHost = toZonedTime(new Date(currentBooking.end), hostTimezone);
    return `${format(startHost, 'EEEE, MMMM d, h:mm a')} - ${format(endHost, 'h:mm a')} (${hostTimezone})`;
  }, [currentBooking, hostTimezone]);

  useEffect(() => {
    if (sortedDates.length === 0) {
      setSelectedDate(hostFallbackDate);
      setSelectedSlotStart(null);
      return;
    }

    if (!sortedDates.includes(selectedDate)) {
      setSelectedDate(sortedDates[0]);
      setSelectedSlotStart(null);
    }
  }, [sortedDates, selectedDate, hostFallbackDate]);

  const hostTodayLabel = useMemo(() => {
    const hostNow = toZonedTime(new Date(), hostTimezone);
    return format(hostNow, 'yyyy-MM-dd');
  }, [hostTimezone]);

  useEffect(() => {
    if (!initialFallback && initialSource === 'google') {
      return;
    }

    if (isReschedule && !rescheduleToken) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const refreshAvailability = async () => {
      try {
        setRefreshState({ status: 'refreshing' });

        const endpoint = isReschedule
          ? `/api/reschedule?token=${encodeURIComponent(rescheduleToken ?? '')}`
          : `/api/slots?meetingTypeId=${meetingType.id}`;

        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);

        if (isReschedule) {
          if (!response.ok || !data || data.status !== 'ok' || !data.slotsByDate) {
            throw new Error(
              data?.message ?? 'Failed to refresh availability from Google Calendar.',
            );
          }

          if (!isMounted) return;

          setAvailability(cloneAvailabilityMap(data.slotsByDate as AvailabilityByDate));
          setDataSource({
            source: (data.source as 'google' | 'mock') ?? 'google',
            fallback: Boolean(data.fallback),
          });
          if (data.currentSlot && typeof data.currentSlot.start === 'string' && typeof data.currentSlot.end === 'string') {
            setCurrentBooking({ start: data.currentSlot.start, end: data.currentSlot.end });
          }
        } else {
          if (!response.ok || !data || Array.isArray(data.slots) || !data.slots) {
            throw new Error(
              data?.message ?? 'Failed to refresh availability from Google Calendar.',
            );
          }

          if (!isMounted) return;

          setAvailability(cloneAvailabilityMap(data.slots as AvailabilityByDate));
          setDataSource({
            source: (data.source as 'google' | 'mock') ?? 'google',
            fallback: Boolean(data.fallback),
          });
        }

        setRefreshState({ status: 'idle' });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (!isMounted) return;

        const message =
          error instanceof Error ? error.message : 'Unable to refresh live availability.';
        setRefreshState({ status: 'error', message });
      }
    };

    refreshAvailability();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [initialFallback, initialSource, isReschedule, meetingType.id, rescheduleToken]);

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const prevMonth = useMemo(() => subMonths(startOfMonth(currentMonth), 1), [currentMonth]);
  const nextMonth = useMemo(() => addMonths(startOfMonth(currentMonth), 1), [currentMonth]);
  const canGoPrev = prevMonth >= minMonth;
  const canGoNext = nextMonth <= maxMonth;

  const handleDateSelect = (dateLabel: string) => {
    setSelectedDate(dateLabel);
    setSelectedSlotStart(null);
    resetSubmissionFeedback();
  };

  const submitBooking = async (values: BookingFormValues) => {
    if (!selectedSlot) return;

    const slotToBook = selectedSlot;
    setSubmitStatus({ status: 'submitting' });

    try {
      const response = await fetch('/api/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meetingTypeId: meetingType.id,
          slot: slotToBook,
          guest: {
            name: values.guestName,
            email: values.guestEmail,
          },
          guestTimezone,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          setAvailability((prev) => ({
            ...prev,
            [selectedDate]: (prev[selectedDate] ?? []).filter((slot) => slot.start !== slotToBook.start),
          }));
          setSelectedSlotStart(null);
        }

        const message =
          typeof result?.message === 'string'
            ? result.message
            : response.status === 409
              ? 'That slot was just booked. Please choose another time.'
              : 'Failed to schedule your meeting with Google Calendar.';

        throw new Error(message);
      }

      const managementLinks = parseManagementLinks(result?.managementLinks);

      setSubmitStatus({
        status: 'success',
        eventLink: typeof result?.htmlLink === 'string' ? result.htmlLink : undefined,
        videoLink: typeof result?.hangoutLink === 'string' ? result.hangoutLink : undefined,
        manageLinks: managementLinks,
      });

      setAvailability((prev) => ({
        ...prev,
        [selectedDate]: (prev[selectedDate] ?? []).filter((slot) => slot.start !== slotToBook.start),
      }));

      setSelectedSlotStart(null);
      reset();
    } catch (error) {
      setSubmitStatus({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Unexpected error while scheduling your meeting.',
      });
    }
  };

  const submitReschedule = async () => {
    if (!selectedSlot) return;

    if (!rescheduleToken) {
      setSubmitStatus({
        status: 'error',
        message: 'Missing reschedule token. Please use the link provided in your email.',
      });
      return;
    }

    const slotToBook = selectedSlot;
    setSubmitStatus({ status: 'submitting' });

    try {
      const response = await fetch('/api/reschedule', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: rescheduleToken,
          slot: slotToBook,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          setAvailability((prev) => ({
            ...prev,
            [selectedDate]: (prev[selectedDate] ?? []).filter((slot) => slot.start !== slotToBook.start),
          }));
          setSelectedSlotStart(null);
        }

        const message = (() => {
          if (typeof result?.message === 'string') {
            return result.message;
          }

          switch (result?.status) {
            case 'expired':
              return 'This reschedule link has expired. Please request a new one.';
            case 'invalid_token':
              return 'The reschedule link is invalid. Double-check the URL or contact the host for help.';
            case 'not_found':
              return 'We could not find an active event to reschedule. It may have been cancelled already.';
            case 'unavailable':
              return 'That time was just booked. Please choose another slot.';
            case 'unchanged':
              return 'Select a different time to reschedule this meeting.';
            case 'google_error':
              return 'Google Calendar returned an error while rescheduling. Please try again shortly.';
            default:
              return response.status >= 500
                ? 'We ran into a server issue while rescheduling. Please try again.'
                : 'Unable to reschedule this meeting right now.';
          }
        })();

        throw new Error(message);
      }

      const event = (result?.event ?? {}) as {
        id?: string;
        start?: string;
        end?: string;
        htmlLink?: string;
        hangoutLink?: string;
      };

      const updatedSlot: UtcSlot = {
        start: typeof event.start === 'string' ? event.start : slotToBook.start,
        end: typeof event.end === 'string' ? event.end : slotToBook.end,
      };

      const managementLinks = parseManagementLinks(result?.managementLinks);

      setSubmitStatus({
        status: 'success',
        eventLink: typeof event.htmlLink === 'string' ? event.htmlLink : undefined,
        videoLink: typeof event.hangoutLink === 'string' ? event.hangoutLink : undefined,
        updatedSlot,
        manageLinks: managementLinks,
      });

      setCurrentBooking(updatedSlot);
      setAvailability((prev) => ({
        ...prev,
        [selectedDate]: (prev[selectedDate] ?? []).filter((slot) => slot.start !== slotToBook.start),
      }));
      setSelectedSlotStart(null);
    } catch (error) {
      setSubmitStatus({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unexpected error while rescheduling your meeting.',
      });
    }
  };

  const onSubmit = isReschedule
    ? async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await submitReschedule();
      }
    : handleSubmit(async (values) => submitBooking(values));

  const submitButtonLabel = isReschedule ? 'Confirm reschedule' : 'Confirm booking';
  const submittingLabel = isReschedule ? 'Rescheduling...' : 'Scheduling...';
  const successTitle = isReschedule ? 'Meeting rescheduled!' : 'Booking confirmed!';
  const inviteFallbackText = isReschedule
    ? 'Everyone will receive an updated invite shortly.'
    : "You'll receive a calendar invite shortly.";
  const isSubmitDisabled =
    !selectedSlot ||
    submitStatus.status === 'submitting' ||
    (isReschedule ? !rescheduleToken : !isValid);

  useEffect(() => {
    if (isReschedule || submitStatus.status !== 'success') {
      return;
    }

    const manageToken = submitStatus.manageLinks?.manage?.token;
    if (!manageToken) {
      return;
    }

    router.push(`/confirm?token=${encodeURIComponent(manageToken)}`);
  }, [isReschedule, submitStatus, router]);

  if (!sortedDates.length) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center px-6 text-center">
        <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-12 shadow-[var(--shadow-soft)]">
          <h1 className="text-3xl font-semibold text-slate-900">Availability coming soon</h1>
          <p className="mt-4 max-w-xl text-pretty text-slate-600">
            We are still configuring slots for this meeting type. Check back shortly or contact the host
            directly to coordinate a time.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 pb-16 pt-14 lg:px-12">
      <section className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-10 shadow-[var(--shadow-soft)]">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-500">
            Ryan&apos;s Personal Scheduler
          </p>
          <h1 className="text-4xl font-semibold leading-tight text-slate-900 lg:text-5xl">
            Book your intro call in a couple of clicks.
          </h1>
          <p className="max-w-2xl text-lg text-slate-600">
            I open up focused 30-minute sessions so we can explore ideas and next steps without long email threads.
            Pick a time that works for you - my calendar stays in sync with Google behind the scenes.
          </p>
        </div>
      </section>

      <header className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-8 shadow-[var(--shadow-soft)] lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-500">
            {meetingType.title}
          </p>
          <h2 className="text-3xl font-semibold text-slate-900 lg:text-4xl">
            {isReschedule ? 'Pick a new time' : 'Pick a date and time'}
          </h2>
          <p className="text-balance text-sm text-slate-600">
            Slots refresh directly from Google Calendar, so as soon as you confirm we’ll send a calendar
            invite to everyone involved.
          </p>
          {isReschedule && currentBookingHostLabel ? (
            <p className="text-sm text-slate-500">
              Currently scheduled for {currentBookingHostLabel}
            </p>
          ) : null}
        </div>
        <div className="rounded-[var(--radius-md)] border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-500">Meeting duration</p>
          <p className="text-lg font-semibold text-slate-900">{meetingType.durationMinutes} minutes</p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">Host timezone</p>
          <p className="font-medium text-slate-600">{hostTimezone}</p>
        </div>
      </header>

      {dataSource.source === 'mock' ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-amber-200 bg-amber-50 p-5 text-sm text-amber-700">
          <p className="font-semibold text-amber-800">Showing sample availability</p>
          <p className="mt-1 text-amber-700">
            Google Calendar couldn&apos;t be reached, so these slots are examples. We&apos;ll keep trying to
            load the live schedule automatically.
          </p>
          {refreshState.status === 'refreshing' ? (
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-amber-600">Refreshing live availability…</p>
          ) : null}
          {refreshState.status === 'error' ? (
            <p className="mt-2 text-xs text-amber-600">{refreshState.message}</p>
          ) : null}
        </div>
      ) : refreshState.status === 'error' ? (
        <div className="rounded-[var(--radius-lg)] border border-sky-200 bg-sky-50 p-4 text-sm text-sky-700">
          <p className="font-medium">Using cached availability</p>
          <p className="mt-1">We’ll retry Google Calendar shortly: {refreshState.message}</p>
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col gap-6">
          <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-6 shadow-[var(--shadow-soft)]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Select a date</h2>
                <p className="text-sm text-slate-500">
                  Calendar shown in host timezone ({hostTimezone}). You can change slot times below.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => canGoPrev && setCurrentMonth(prevMonth)}
                  disabled={!canGoPrev}
                  className={clsx(
                    'inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                    !canGoPrev && 'cursor-not-allowed opacity-40',
                  )}
                  aria-label="Previous month"
                >
                  {'<'}
                </button>
                <div className="text-center text-sm font-semibold text-slate-700">
                  {format(currentMonth, 'MMMM yyyy')}
                </div>
                <button
                  type="button"
                  onClick={() => canGoNext && setCurrentMonth(nextMonth)}
                  disabled={!canGoNext}
                  className={clsx(
                    'inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                    !canGoNext && 'cursor-not-allowed opacity-40',
                  )}
                  aria-label="Next month"
                >
                  {'>'}
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-7 gap-2 text-center text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-7 gap-2">
              {monthDays.map((day) => {
                const dateLabel = format(day, 'yyyy-MM-dd');
                const isCurrentMonth = format(day, 'yyyy-MM') === format(currentMonth, 'yyyy-MM');
                const slots = availability[dateLabel] ?? [];
                const isAvailable = slots.length > 0;
                const isDisabled = !isAvailable || !isCurrentMonth;
                const isSelected = selectedDate === dateLabel;
                const isToday = dateLabel === hostTodayLabel;

                const ariaLabelParts = [format(day, 'MMMM d, yyyy')];
                if (isToday) ariaLabelParts.push('today');
                ariaLabelParts.push(isAvailable ? 'available' : 'unavailable');

                return (
                  <button
                    key={dateLabel}
                    type="button"
                    onClick={() => !isDisabled && handleDateSelect(dateLabel)}
                    disabled={isDisabled}
                    aria-pressed={isSelected}
                    aria-label={ariaLabelParts.join(', ')}
                    className={clsx(
                      'group relative flex h-11 w-full items-center justify-center rounded-full border text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                      isSelected
                        ? 'border-transparent bg-sky-600 text-white shadow-lg shadow-sky-600/25'
                        : 'border-slate-200 bg-white text-slate-700 hover:shadow-md',
                      isDisabled && 'cursor-not-allowed border-transparent bg-slate-100 text-slate-300 hover:shadow-none',
                      isToday && !isSelected && 'border-sky-400 text-sky-600',
                    )}
                  >
                    <span>{format(day, 'd')}</span>
                    {isToday ? (
                      <span className="pointer-events-none absolute -top-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-sky-500">
                        Today
                      </span>
                    ) : null}
                    {isAvailable && !isDisabled ? (
                      <span className="pointer-events-none absolute -bottom-2 flex h-1.5 w-5 items-center justify-center">
                        <span className="h-1 rounded-full bg-sky-500/80 transition group-hover:bg-sky-500" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <LegendDot color="bg-sky-500" label="Available" />
              <LegendDot color="bg-slate-200" label="Unavailable" />
              <LegendDot color="bg-sky-400" label="Today" />
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-6 shadow-[var(--shadow-soft)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Pick a time</h2>
                <p className="text-sm text-slate-500">
                  Showing options in
                  <span className="ml-1 font-semibold text-slate-700">{guestTimezone}</span>
                </p>
              </div>
              <label className="flex items-center gap-3 text-sm text-slate-600">
                <span className="font-medium">Timezone</span>
                <select
                  value={guestTimezone}
                  onChange={(event) => setGuestTimezone(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                >
                  {GUEST_TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="mt-4 text-sm font-medium text-slate-600">
              {format(createDateFromLabel(selectedDate), 'EEEE, MMMM d')}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {slotsForSelectedDate.length === 0 ? (
                <p className="col-span-full rounded-[var(--radius-md)] border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                  No openings for this date. Try another day.
                </p>
              ) : null}

              {slotsForSelectedDate.map((slot) => {
                const startGuest = toZonedTime(new Date(slot.start), guestTimezone);
                const endGuest = toZonedTime(new Date(slot.end), guestTimezone);
                const startLabel = format(startGuest, 'h:mm a');
                const endLabel = format(endGuest, 'h:mm a');
                const isActive = selectedSlotStart === slot.start;

                return (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => {
                      resetSubmissionFeedback();
                      setSelectedSlotStart(slot.start);
                    }}
                    aria-pressed={isActive}
                    className={clsx(
                      'flex items-center justify-between rounded-[var(--radius-md)] border bg-white px-4 py-3 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                      isActive
                        ? 'border-transparent bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                        : 'border-slate-200 text-slate-700 hover:border-sky-200 hover:bg-sky-50',
                    )}
                  >
                    <span>
                      {startLabel}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {meetingType.durationMinutes} min
                      </span>
                    </span>
                    <span className={clsx('text-xs font-medium', isActive ? 'text-white' : 'text-slate-500')}>
                      {endLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <form
          className="flex flex-col gap-6 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-6 shadow-[var(--shadow-soft)]"
          onSubmit={onSubmit}
        >
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Tell us about you</h2>
            <p className="text-sm text-slate-500">Your details help us tailor the conversation.</p>
          </div>

          <div className="space-y-4">
            {isReschedule ? (
              <div className="rounded-[var(--radius-md)] border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-500">Guest</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {guestInfo?.name ?? 'Guest'}
                  <span className="ml-2 text-xs font-normal text-slate-500">{guestInfo?.email ?? 'Email not provided'}</span>
                </p>
                {currentBookingGuestLabel ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Currently booked for {currentBookingGuestLabel} ({guestTimezone})
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <Field>
                  <label htmlFor="guestName" className="text-sm font-medium text-slate-700">
                    Full name
                  </label>
                  <input
                    id="guestName"
                    type="text"
                    {...register('guestName')}
                    className={clsx(
                      'w-full rounded-[var(--radius-md)] border px-4 py-2.5 text-sm shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                      errors.guestName ? 'border-red-400' : 'border-slate-200',
                    )}
                    placeholder="Jane Doe"
                    autoComplete="name"
                  />
                  {errors.guestName ? (
                    <p className="text-xs text-red-500">{errors.guestName.message}</p>
                  ) : null}
                </Field>

                <Field>
                  <label htmlFor="guestEmail" className="text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    id="guestEmail"
                    type="email"
                    {...register('guestEmail')}
                    className={clsx(
                      'w-full rounded-[var(--radius-md)] border px-4 py-2.5 text-sm shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                      errors.guestEmail ? 'border-red-400' : 'border-slate-200',
                    )}
                    placeholder="jane@example.com"
                    autoComplete="email"
                  />
                  {errors.guestEmail ? (
                    <p className="text-xs text-red-500">{errors.guestEmail.message}</p>
                  ) : null}
                </Field>
              </>
            )}
          </div>

          <div className="rounded-[var(--radius-md)] border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-500">Summary</p>
            <p className="mt-2 font-semibold text-slate-900">{meetingType.title}</p>
            {isReschedule && currentBookingGuestLabel ? (
              <SummaryRow label="Current meeting" value={currentBookingGuestLabel} />
            ) : null}
            <SummaryRow label="Date" value={format(createDateFromLabel(selectedDate), 'EEEE, MMMM d')} />
            <SummaryRow
              label="Time"
              value={selectedSlot ? formatSlotRange(selectedSlot, guestTimezone) : 'Select a slot to continue'}
            />
            <SummaryRow label="Timezone" value={guestTimezone} />
          </div>

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className={clsx(
              'flex h-12 w-full items-center justify-center rounded-full bg-sky-600 px-6 text-sm font-semibold text-white shadow transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
              (isSubmitDisabled && submitStatus.status !== 'submitting') && 'cursor-not-allowed opacity-60',
              submitStatus.status === 'submitting' && 'animate-pulse',
            )}
          >
            {submitStatus.status === 'submitting' ? submittingLabel : submitButtonLabel}
          </button>

          {submitStatus.status === 'error' ? (
            <p className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 p-3 text-center text-sm font-medium text-red-600">
              {submitStatus.message}
            </p>
          ) : null}

          {submitStatus.status === 'success' ? (
            <div className="rounded-[var(--radius-md)] border border-sky-200 bg-sky-50 p-3 text-center text-sm font-medium text-sky-600">
              <p className="font-semibold">{successTitle}</p>
              {isReschedule && submitStatus.updatedSlot ? (
                <p className="mt-1 text-xs font-normal text-sky-600">
                  New time: {formatSlotRange(submitStatus.updatedSlot, guestTimezone)} ({guestTimezone})
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-sm font-medium">
                {submitStatus.videoLink ? (
                  <a
                    href={submitStatus.videoLink}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-sky-600 px-4 py-2 text-white underline-offset-4 transition hover:bg-sky-700"
                  >
                    Join Google Meet
                  </a>
                ) : null}
                {submitStatus.eventLink ? (
                  <a
                    href={submitStatus.eventLink}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    View in Google Calendar
                  </a>
                ) : (
                  <span>{inviteFallbackText}</span>
                )}
              </div>
              {submitStatus.manageLinks ? (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-slate-600">
                  <a
                    href={submitStatus.manageLinks.manage.path}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-slate-700"
                  >
                    Manage meeting
                  </a>
                  <a
                    href={submitStatus.manageLinks.reschedule.path}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    Reschedule later
                  </a>
                  <a
                    href={submitStatus.manageLinks.cancel.path}
                    className="inline-flex items-center justify-center rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:border-red-300 hover:text-red-700"
                  >
                    Cancel meeting
                  </a>
                </div>
              ) : null}
              {submitStatus.manageLinks?.manage.expiresAt ? (
                <p className="mt-2 text-[11px] font-normal text-slate-500">
                  Links valid until {format(new Date(submitStatus.manageLinks.manage.expiresAt), 'MMM d, yyyy h:mm a')}
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
      </section>
    </main>
  );
}

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

function parseManagementLinks(candidate: unknown): ManagementLinks | undefined {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }

  const data = candidate as {
    cancel?: { token?: unknown; expiresAt?: unknown; path?: unknown; url?: unknown };
    reschedule?: { token?: unknown; expiresAt?: unknown; path?: unknown; url?: unknown };
    manage?: { token?: unknown; expiresAt?: unknown; path?: unknown; url?: unknown };
  };

  if (
    typeof data.cancel?.token !== 'string' ||
    typeof data.reschedule?.token !== 'string' ||
    typeof data.manage?.token !== 'string'
  ) {
    return undefined;
  }

  const cancelPath =
    typeof data.cancel?.path === 'string' ? data.cancel.path : `/cancel/${data.cancel.token}`;
  const reschedulePath =
    typeof data.reschedule?.path === 'string'
      ? data.reschedule.path
      : `/reschedule/${data.reschedule.token}`;
  const managePath =
    typeof data.manage?.path === 'string' ? data.manage.path : `/manage/${data.manage.token}`;

  return {
    cancel: {
      token: data.cancel.token,
      path: cancelPath,
      url: typeof data.cancel?.url === 'string' ? data.cancel.url : cancelPath,
      expiresAt: typeof data.cancel?.expiresAt === 'string' ? data.cancel.expiresAt : '',
    },
    reschedule: {
      token: data.reschedule.token,
      path: reschedulePath,
      url: typeof data.reschedule?.url === 'string' ? data.reschedule.url : reschedulePath,
      expiresAt:
        typeof data.reschedule?.expiresAt === 'string' ? data.reschedule.expiresAt : '',
    },
    manage: {
      token: data.manage.token,
      path: managePath,
      url: typeof data.manage?.url === 'string' ? data.manage.url : managePath,
      expiresAt: typeof data.manage?.expiresAt === 'string' ? data.manage.expiresAt : '',
    },
  };
}

