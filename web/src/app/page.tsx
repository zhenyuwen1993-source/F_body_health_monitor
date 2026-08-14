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

        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          你的身体，
          <br />
          <span className="bg-gradient-to-r from-emerald-500 to-sky-500 bg-clip-text text-transparent">
            终于看得懂了
          </span>
        </h1>

        <p className="max-w-md text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Apple Watch 记了一堆数据，但没人告诉你那到底意味着什么。把导出文件拖进来，我们用大白话说清楚：昨晚睡得好不好、今天适不适合运动、身体有没有在硬扛。
        </p>

        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          开始看我的数据
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 stroke-current" strokeWidth={2}>
            <path d="M5 12h14m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <p className="text-xs text-zinc-400">导出文件只在你自己的设备上解析，不会上传</p>
      </main>
    </div>
  );
}
