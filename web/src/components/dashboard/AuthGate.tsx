"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import AuthPanel, { type QuotaInfo, type SessionUser } from "./AuthPanel";
import ProfileForm, { type ProfileData } from "./ProfileForm";
import { isComplete } from "@/lib/health/body";

interface SessionValue {
  user: SessionUser;
  quota: QuotaInfo | null;
  profile: ProfileData;
  setProfile: (p: ProfileData) => void;
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
  const [profile, setProfile] = useState<ProfileData | null>(null);
  // "以后再填" must survive reloads, or every visit re-asks for height/weight.
  const [skippedProfile, setSkippedProfile] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("striortus:profileSkip") === "1";
    } catch {
      return false;
    }
  });
  const skipProfile = () => {
    setSkippedProfile(true);
    try {
      localStorage.setItem("striortus:profileSkip", "1");
    } catch {}
  };
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await (await fetch("/api/auth")).json();
        if (cancelled) return;
        if (j.user) {
          setUser(j.user);
          if (j.quota) setQuota(j.quota);
          const pr = await fetch("/api/profile")
            .then((r) => r.json())
            .catch(() => null);
          if (!cancelled && pr?.profile) setProfile(pr.profile);
        }
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
    setProfile(null);
    setSkippedProfile(false);
    try {
      localStorage.removeItem("striortus:profileSkip");
    } catch {}
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
            fetch("/api/profile")
              .then((r) => r.json())
              .then((j) => j.profile && setProfile(j.profile))
              .catch(() => {});
          }}
        />
      </div>
    );
  }

  // Height and weight unlock BMI, basal metabolism and heart-rate zones, so we
  // ask once up front — but never block someone who'd rather get on with it.
  if (profile && !isComplete(profile) && !skippedProfile) {
    return (
      <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-6 px-5 py-16">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            先说说你的身体
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            身高体重是手表数据里没有的，填一次就够了。有了它才能算 BMI、基础代谢和运动强度区间。
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <ProfileForm
            profile={profile}
            compact
            onSaved={(p) => setProfile(p)}
            onSkip={skipProfile}
          />
        </div>
      </div>
    );
  }

  return (
    <SessionContext.Provider
      value={{
        user,
        quota,
        profile: profile ?? {
          heightCm: null,
          weightKg: null,
          bodyFatPct: null,
          birthYear: null,
          sex: null,
        },
        setProfile,
        refreshQuota,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
