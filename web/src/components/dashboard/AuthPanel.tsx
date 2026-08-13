"use client";

import { useState } from "react";

export interface SessionUser {
  id: number;
  email: string;
}
export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
}

/** Inline sign-up / sign-in shown where the chat would be. */
export default function AuthPanel({
  onSignedIn,
}: {
  onSignedIn: (user: SessionUser, quota?: QuotaInfo) => void;
}) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, email, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `失败 (${res.status})`);
        return;
      }
      onSignedIn(j.user, j.quota);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {mode === "register" ? "注册后就能提问" : "登录后继续提问"}
      </h3>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        每个账号每天可以问 10 个问题。注册只用来记次数，我们不会保存你的健康数据。
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          autoComplete="email"
          className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:text-zinc-100"
        />
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（至少 8 位）"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:text-zinc-100"
        />
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {busy ? "处理中…" : mode === "register" ? "注册" : "登录"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode((m) => (m === "register" ? "login" : "register"));
          setError(null);
        }}
        className="mt-3 text-xs text-zinc-500 underline underline-offset-2 hover:text-emerald-600"
      >
        {mode === "register" ? "已经有账号了？去登录" : "还没有账号？去注册"}
      </button>
    </div>
  );
}
