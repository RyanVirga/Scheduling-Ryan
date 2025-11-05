'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';

type LegendDotProps = {
  color: string;
  label: string;
};

export function LegendDot({ color, label }: LegendDotProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={clsx('inline-flex h-2.5 w-2.5 rounded-full', color)} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

type SummaryRowProps = {
  label: string;
  value: string;
};

export function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span className="font-medium text-slate-500">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}

type SectionCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-6 shadow-[var(--shadow-soft)]">
      <header className="space-y-1.5">
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </header>
      <div className="mt-5">{children}</div>
    </section>
  );
}

