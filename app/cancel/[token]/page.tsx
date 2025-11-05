import Link from "next/link";
import { headers } from "next/headers";

export const revalidate = 0;

type CancelPageProps = {
  params: Promise<{ token: string }>;
};

type CancelApiResponse = {
  status: "cancelled" | "invalid_token" | "expired" | "not_found" | "google_error" | "error";
  message?: string;
  meetingTypeId?: string;
  eventId?: string;
  guestEmail?: string;
  calendarId?: string;
};

async function requestCancellation(token: string): Promise<{ result: CancelApiResponse; statusCode: number }> {
  const headerList = headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");

  const endpoint = new URL(`${protocol}://${host}/cancel`);
  endpoint.searchParams.set("token", token);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const payload = (await response.json().catch(() => null)) as CancelApiResponse | null;

    return {
      result:
        payload ?? {
          status: "error",
          message: "Unable to cancel the meeting due to an unexpected response.",
        },
      statusCode: response.status,
    };
  } catch (error) {
    console.error("[cancel-page] Failed to call cancellation endpoint", error);
    return {
      result: {
        status: "error",
        message: "We couldn’t reach the cancellation service. Please try again shortly.",
      },
      statusCode: 500,
    };
  }
}

function resolveCopy(result: CancelApiResponse, statusCode: number) {
  switch (result.status) {
    case "cancelled":
      return {
        badge: "Cancelled",
        title: "Meeting cancelled",
        description:
          "We’ve removed the meeting from the calendar and notified everyone who was invited.",
        tone: "success" as const,
      };
    case "expired":
      return {
        badge: "Expired",
        title: "This link has expired",
        description:
          result.message ??
          "Cancellation links are only valid for a limited time. Reach out to the host if you still need to make a change.",
        tone: "warning" as const,
      };
    case "not_found":
      return {
        badge: "Not Found",
        title: "Meeting already cancelled",
        description:
          result.message ??
          "We couldn’t find an active event for this link. It may have already been cancelled or moved.",
        tone: "warning" as const,
      };
    case "invalid_token":
      return {
        badge: "Invalid",
        title: "Cancellation link is invalid",
        description:
          result.message ??
          "The link appears to be malformed. Please double-check the URL or contact the host for help.",
        tone: "error" as const,
      };
    case "google_error":
      return {
        badge: "Calendar Error",
        title: "We couldn’t reach Google Calendar",
        description:
          result.message ??
          "Google Calendar returned an error while processing the cancellation. Please try again or contact the host.",
        tone: "error" as const,
      };
    default:
      return {
        badge: statusCode >= 500 ? "Server Error" : "Error",
        title: "Something went wrong",
        description:
          result.message ??
          "We ran into an unexpected issue while processing your request. Please try again in a moment.",
        tone: "error" as const,
      };
  }
}

export default async function CancelPage({ params }: CancelPageProps) {
  const { token } = await params;

  const { result, statusCode } = await requestCancellation(token);
  const copy = resolveCopy(result, statusCode);

  const badgeStyles: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700 border-emerald-200",
    warning: "bg-amber-100 text-amber-800 border-amber-200",
    error: "bg-red-100 text-red-700 border-red-200",
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
            Book another time
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

