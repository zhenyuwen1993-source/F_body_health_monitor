"use client";

import { LEVEL_COLOR, type Level } from "@/lib/health/interpret";

interface SummaryHeroProps {
  greeting: string;
  paragraphs: string[];
  level: Level;
  date: string;
}

/**
 * The first thing on the page: what today looks like, in sentences. Numbers and
 * scores come after — most people want the conclusion, not the dashboard.
 */
export default function SummaryHero({
  greeting,
  paragraphs,
  level,
  date,
}: SummaryHeroProps) {
  const color = LEVEL_COLOR[level];
  return (
    <section
      className="rounded-2xl border p-6 sm:p-8"
      style={{ borderColor: `${color}40`, backgroundColor: `${color}0d` }}
    >
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        今天 · {date}
      </div>
      <h1
        className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
        style={{ color }}
      >
        {greeting}
      </h1>
      <div className="mt-4 space-y-2.5">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-[15px] leading-7 text-zinc-700 dark:text-zinc-200">
            {p}
          </p>
        ))}
      </div>
    </section>
  );
}
