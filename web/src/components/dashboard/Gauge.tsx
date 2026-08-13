// A circular progress gauge for 0-100 scores (or an arbitrary max).

interface GaugeProps {
  value: number | null | undefined;
  max?: number;
  label: string;
  suffix?: string;
  color?: string;
  size?: number;
}

export default function Gauge({
  value,
  max = 100,
  label,
  suffix = "",
  color,
  size = 132,
}: GaugeProps) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const has = value != null && Number.isFinite(value);
  const pct = has ? Math.min(1, Math.max(0, (value as number) / max)) : 0;
  const stroke = color ?? bandColor(has ? ((value as number) / max) * 100 : 0);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={9}
            className="stroke-zinc-200 dark:stroke-zinc-800"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={9}
            stroke={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {has ? formatVal(value as number) : "—"}
          </span>
          {suffix && <span className="text-xs text-zinc-400">{suffix}</span>}
        </div>
      </div>
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
    </div>
  );
}

function formatVal(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function bandColor(pct: number): string {
  if (pct >= 67) return "#10b981"; // green
  if (pct >= 34) return "#f59e0b"; // amber
  return "#ef4444"; // red
}
