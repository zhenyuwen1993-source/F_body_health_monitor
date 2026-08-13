// Small labelled metric tile.

interface StatCardProps {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  hint?: string;
}

export default function StatCard({ label, value, unit, hint }: StatCardProps) {
  const has = value != null && value !== "";
  const display =
    typeof value === "number"
      ? Number.isInteger(value)
        ? value.toLocaleString()
        : value.toFixed(1)
      : value;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {has ? display : "—"}
        </span>
        {has && unit && <span className="text-sm text-zinc-400">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-xs text-zinc-400">{hint}</div>}
    </div>
  );
}
