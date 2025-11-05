import { redirect } from "next/navigation";

import { getActiveMeetingTypes } from "@/lib/slots";

export default function Home() {
  const meetingTypes = getActiveMeetingTypes();
  const firstActive = meetingTypes[0];

  if (firstActive) {
    redirect(`/book/${firstActive.id}`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 text-center">
      <section className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-10 shadow-[var(--shadow-soft)]">
        <h1 className="text-3xl font-semibold text-slate-900">No meetings available</h1>
        <p className="mt-4 text-base text-slate-600">
          There are no active meeting types configured right now. Update `config/meeting_types.json` to
          enable at least one meeting type.
        </p>
      </section>
    </main>
  );
}
