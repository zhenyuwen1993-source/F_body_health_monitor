// Dependency-free SVG line chart with an optional area fill and hover dots.

interface Point {
  label: string; // x label (e.g. date)
  value: number | null;
}

interface SparklineProps {
  data: Point[];
  height?: number;
  stroke?: string;
  fill?: string;
  unit?: string;
  /** Force a y-axis minimum of 0 (good for counts). */
  zeroBased?: boolean;
}

export default function Sparkline({
  data,
  height = 120,
  stroke = "#10b981",
  fill = "rgba(16,185,129,0.12)",
  unit = "",
  zeroBased = false,
}: SparklineProps) {
  const W = 600;
  const H = height;
  const pad = 6;
  const pts = data.filter((d) => d.value != null) as { label: string; value: number }[];

  if (pts.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-zinc-200 text-xs text-zinc-400 dark:border-zinc-800"
        style={{ height: H }}
      >
        暂无数据
      </div>
    );
  }

  const values = pts.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (zeroBased) min = Math.min(0, min);
  if (max === min) max = min + 1;

  const n = data.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - 2 * pad);

  // Build path skipping null gaps.
  let d = "";
  let started = false;
  data.forEach((p, i) => {
    if (p.value == null) {
      started = false;
      return;
    }
    d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;
    started = true;
  });

  // Area path (only when contiguous enough; simple version anchored to baseline).
  const firstIdx = data.findIndex((p) => p.value != null);
  const lastIdx = data.length - 1 - [...data].reverse().findIndex((p) => p.value != null);
  const area =
    d && firstIdx >= 0
      ? `${d}L${x(lastIdx).toFixed(1)},${(H - pad).toFixed(1)} L${x(firstIdx).toFixed(1)},${(
          H - pad
        ).toFixed(1)} Z`
      : "";

  const last = pts[pts.length - 1];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: H }}
      >
        {area && <path d={area} fill={fill} stroke="none" />}
        <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.length <= 40 &&
          data.map((p, i) =>
            p.value == null ? null : (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill={stroke} />
            ),
          )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>{data[firstIdx]?.label}</span>
        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
          最新 {formatNum(last.value)}
          {unit}
        </span>
        <span>{data[lastIdx]?.label}</span>
      </div>
    </div>
  );
}

function formatNum(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2).replace(/\.?0+$/, "");
}
