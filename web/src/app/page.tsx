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

        <div className="mt-4 flex items-center gap-3 rounded-full border border-zinc-200 bg-white/60 px-5 py-2 text-sm text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          Private beta — coming soon
        </div>
      </main>
    </div>
  );
}
