import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-sky-50 dark:from-zinc-950 dark:via-black dark:to-zinc-900">
      <main className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-6 py-24 text-center">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.6)]" />
          <span className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
            Striortus Health
          </span>
        </div>

        <h1 className="text-5xl font-semibold tracking-tight text-zinc-900 sm:text-6xl dark:text-zinc-50">
          Your body,
          <br />
          <span className="bg-gradient-to-r from-emerald-500 to-sky-500 bg-clip-text text-transparent">
            understood.
          </span>
        </h1>

        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Local-first analytics on your Apple Health data. Recovery, strain,
          sleep — decoded, not just displayed.
        </p>

        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          打开仪表盘
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 stroke-current" strokeWidth={2}>
            <path d="M5 12h14m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <p className="text-xs text-zinc-400">在浏览器本地解析你的 Apple Health 数据 · 不上传服务器</p>
      </main>
    </div>
  );
}
