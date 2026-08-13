"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import AuthPanel, { type QuotaInfo, type SessionUser } from "./AuthPanel";

interface SessionValue {
  user: SessionUser;
  quota: QuotaInfo | null;
  refreshQuota: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside AuthGate");
  return v;
}

/**
 * Signing in is the first thing that happens: everything past this point either
 * costs money (the AI) or has to persist per person (the training log), so
 * there's no useful anonymous state to fall through to.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await (await fetch("/api/auth")).json();
        if (cancelled) return;
        if (j.user) setUser(j.user);
        if (j.quota) setQuota(j.quota);
      } catch {
        // Offline or server down — treated as signed out.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshQuota = useCallback(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((j) => j.quota && setQuota(j.quota))
      .catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    }).catch(() => {});
    setUser(null);
    setQuota(null);
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-full items-center justify-center py-24 text-sm text-zinc-400">
        载入中…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 px-5 py-16">
        <div className="text-center">
          <div className="mx-auto mb-4 flex items-center justify-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
              Striortus Health
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            先登录，再看你的身体数据
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            账号用来保存你的训练记录，并给每个人分配每天的 AI 提问额度。
            你的健康数据依然只在自己的设备上处理，不会上传。
          </p>
        </div>

        <AuthPanel
          onSignedIn={(u, q) => {
            setUser(u);
            if (q) setQuota(q);
          }}
        />
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ user, quota, refreshQuota, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
