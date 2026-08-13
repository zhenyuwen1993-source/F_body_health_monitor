"use client";

import { useState } from "react";
import { metricInfo } from "@/lib/health/glossary";
import { LEVEL_COLOR, type Verdict } from "@/lib/health/interpret";

interface MetricCardProps {
  /** Metric key used to look up the plain-language explanation. */
  metricKey: string;
  /** Overrides the glossary name when the card needs a shorter label. */
  label?: string;
  value: number | string | null | undefined;
  unit?: string;
  verdict?: Verdict;
  /** e.g. "08-12 的数据" when today's value hasn't synced yet. */
  asOf?: string;
}

export default function MetricCard({
  metricKey,
  label,
  value,
  unit,
  verdict,
  asOf,
}: MetricCardProps) {
  const [open, setOpen] = useState(false);
  const info = metricInfo(metricKey);
  const name = label ?? info?.name ?? metricKey;
  const has = value != null && value !== "";
  const display =
    typeof value === "number"
      ? Number.isInteger(value)
        ? value.toLocaleString()
        : value.toFixed(1)
      : value;
  const color = verdict ? LEVEL_COLOR[verdict.level] : undefined;

  return (
    <div className="relative rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{name}</div>
        {info && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={`${name}是什么`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[11px] leading-none text-zinc-400 transition hover:border-emerald-400 hover:text-emerald-600 dark:border-zinc-700"
          >
            ?
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {has ? display : "—"}
        </span>
        {has && unit && <span className="text-sm text-zinc-400">{unit}</span>}
      </div>

      {verdict && has && (
        <div className="mt-2">
          <span
            className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {verdict.label}
          </span>
          {verdict.detail && (
            <p className="mt-1.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {verdict.detail}
            </p>
          )}
        </div>
      )}
      {!has && <p className="mt-2 text-xs text-zinc-400">这项没有数据</p>}
      {asOf && <p className="mt-1 text-[11px] text-zinc-400">{asOf}</p>}

      {open && info && (
        <div className="mt-3 space-y-2 rounded-lg bg-zinc-50 p-3 text-xs leading-5 dark:bg-zinc-800/60">
          <Row label="这是什么" text={info.what} />
          <Row label="为什么重要" text={info.why} />
          <Row label="参考范围" text={info.healthy} />
          {info.notes && <Row label="注意" text={info.notes} />}
        </div>
      )}
    </div>
  );
}

function Row({ label, text }: { label: string; text: string }) {
  return (
    <p className="text-zinc-600 dark:text-zinc-300">
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{label}：</span>
      {text}
    </p>
  );
}
