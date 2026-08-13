"use client";

import { useCallback, useState } from "react";
import DashboardView from "@/components/dashboard/DashboardView";
import { buildDataset, type HealthDataset, type ParseProgress } from "@/lib/health";

type Phase = "idle" | "parsing" | "done" | "error";

export default function DashboardPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [data, setData] = useState<HealthDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setPhase("parsing");
    setError(null);
    setProgress(null);
    try {
      const ds = await buildDataset(file, (p) => setProgress({ ...p }));
      if (ds.daily.length === 0) {
        setError("没有读到可用的数据。请确认这是健康 App 导出的文件。");
        setPhase("error");
        return;
      }
      setData(ds);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  if (phase === "done" && data) {
    return <DashboardView data={data} onReset={() => setPhase("idle")} />;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-7 px-5 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          看懂你的身体数据
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          把 Apple 健康的导出文件拖进来，几秒后你会看到一段人话总结：昨晚睡得怎么样、今天适不适合运动、有没有需要留意的地方。
        </p>
      </div>

      <div className="rounded-xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        <p className="mb-1.5 font-medium text-zinc-900 dark:text-zinc-100">怎么拿到这个文件</p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>打开 iPhone 的「健康」App</li>
          <li>点右上角你的头像</li>
            <li>滑到最下面，点「导出所有健康数据」</li>
          <li>存下来，把得到的压缩包拖到下面即可</li>
        </ol>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 transition ${
          dragOver
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-zinc-300 hover:border-emerald-400 dark:border-zinc-700"
        }`}
      >
        <div className="h-10 w-10 rounded-full bg-emerald-500/10 p-2.5">
          <svg viewBox="0 0 24 24" fill="none" className="h-full w-full stroke-emerald-500" strokeWidth={2}>
            <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          点这里选文件，或直接拖进来
        </span>
        <span className="text-xs text-zinc-400">
          文件很大也没关系 · 全程在你手机/电脑上处理，不会上传
        </span>
        <input
          type="file"
          accept=".zip,.xml,text/xml,application/xml,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </label>

      {phase === "parsing" && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300">
            <span>正在读取，请稍等…</span>
            {progress && (
              <span className="tabular-nums text-zinc-400">
                已读 {progress.records.toLocaleString()} 条
              </span>
            )}
          </div>
          {progress && progress.totalBytes > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${Math.min(100, (progress.bytesRead / progress.totalBytes) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {phase === "error" && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
