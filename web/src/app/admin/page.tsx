"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminUser {
  id: number;
  email: string;
  createdAt: string;
  today: number;
  total: number;
  lastUsed: string | null;
  isAdmin: boolean;
}

interface Payload {
  stats: { users: number; callsToday: number; callsTotal: number };
  daily: { day: string; calls: number }[];
  users: AdminUser[];
}

// Rough per-call cost, only to give the owner a sense of scale.
const CNY_PER_CALL = 0.004;

export default function AdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin");
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? `请求失败 (${res.status})`);
        return;
      }
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin");
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(j.error ?? `请求失败 (${res.status})`);
        else setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const act = async (action: string, id: number) => {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id }),
    }).catch(() => {});
    load();
  };

  if (loading)
    return <div className="py-24 text-center text-sm text-zinc-400">载入中…</div>;

  if (error)
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
        <p className="mt-2 text-xs text-zinc-400">
          管理页需要用 ADMIN_EMAILS 里列出的邮箱登录。
        </p>
        <a href="/dashboard" className="mt-4 inline-block text-sm text-emerald-600 underline">
          回到主页
        </a>
      </div>
    );

  if (!data) return null;

  const peak = Math.max(1, ...data.daily.map((d) => d.calls));

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">后台</h1>
          <p className="text-xs text-zinc-400">注册用户与 AI 用量</p>
        </div>
        <a
          href="/dashboard"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          回到主页
        </a>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="注册用户" value={data.stats.users} />
        <Stat label="今天提问" value={data.stats.callsToday} />
        <Stat label="累计提问" value={data.stats.callsTotal} />
        <Stat
          label="累计花费（估算）"
          value={`¥${(data.stats.callsTotal * CNY_PER_CALL).toFixed(2)}`}
          hint={`按每次约 ¥${CNY_PER_CALL} 估`}
        />
      </div>

      {data.daily.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            最近 30 天用量
          </h2>
          <div className="flex h-24 items-end gap-1 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            {data.daily.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${d.calls} 次`}
                className="flex-1 rounded-t bg-emerald-500"
                style={{ height: `${Math.max(4, (d.calls / peak) * 100)}%` }}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          用户（{data.users.length}）
        </h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-400 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium">邮箱</th>
                <th className="px-4 py-2 text-left font-medium">注册于</th>
                <th className="px-4 py-2 text-right font-medium">今天</th>
                <th className="px-4 py-2 text-right font-medium">累计</th>
                <th className="px-4 py-2 text-left font-medium">最后使用</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.users.map((u) => (
                <tr key={u.id} className="text-zinc-700 dark:text-zinc-200">
                  <td className="px-4 py-2">
                    {u.email}
                    {u.isAdmin && (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        管理员
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{u.createdAt}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{u.today}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{u.total}</td>
                  <td className="px-4 py-2 text-zinc-500">{u.lastUsed ?? "—"}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => act("resetQuota", u.id)}
                      className="text-xs text-zinc-500 underline underline-offset-2 hover:text-emerald-600"
                    >
                      重置今日
                    </button>
                    {!u.isAdmin && (
                      <button
                        onClick={() => {
                          if (confirm(`确定删除 ${u.email}？该用户的训练记录也会一起删除。`))
                            act("deleteUser", u.id);
                        }}
                        className="ml-3 text-xs text-zinc-400 underline underline-offset-2 hover:text-red-600"
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-zinc-400">{hint}</div>}
    </div>
  );
}
