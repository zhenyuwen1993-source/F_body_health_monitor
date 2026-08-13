"use client";

import { useState } from "react";
import { useSession } from "./AuthGate";

export interface TabDef {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
}

/**
 * Sidebar on desktop, a scrollable strip on phones. One section at a time
 * instead of one very long page.
 */
export default function Shell({
  tabs,
  active,
  onSelect,
  meta,
  children,
  onReset,
}: {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  meta: string;
  children: React.ReactNode;
  onReset: () => void;
}) {
  const { user, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-6 sm:px-6">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-52 shrink-0 lg:block">
        <div className="sticky top-6">
          <div className="mb-5 flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Striortus Health
              </div>
              <div className="text-[11px] text-zinc-400">{meta}</div>
            </div>
          </div>

          <nav className="space-y-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelect(t.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                  active === t.id
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="shrink-0">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>

          <div className="mt-6 space-y-1 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="truncate px-3 text-[11px] text-zinc-400">{user.email}</p>
            {user.isAdmin && (
              <a
                href="/admin"
                className="block rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                后台
              </a>
            )}
            <button
              onClick={onReset}
              className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              换个文件
            </button>
            <button
              onClick={signOut}
              className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              退出登录
            </button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Mobile header + tab strip */}
        <div className="mb-4 lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Striortus Health
              </span>
            </div>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-700"
            >
              账号
            </button>
          </div>
          {menuOpen && (
            <div className="mb-3 space-y-1 rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-800">
              <p className="truncate px-2 text-zinc-400">{user.email}</p>
              {user.isAdmin && (
                <a href="/admin" className="block rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  后台
                </a>
              )}
              <button
                onClick={onReset}
                className="w-full rounded px-2 py-1 text-left text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                换个文件
              </button>
              <button
                onClick={signOut}
                className="w-full rounded px-2 py-1 text-left text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                退出登录
              </button>
            </div>
          )}
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelect(t.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition ${
                  active === t.id
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
