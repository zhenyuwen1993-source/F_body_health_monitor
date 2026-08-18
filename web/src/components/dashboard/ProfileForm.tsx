"use client";

import { useState } from "react";
import { LEVEL_COLOR } from "@/lib/health/interpret";
import { bmi, bmr, bodyFatReading, hrMax, type BodyProfile } from "@/lib/health/body";

export interface ProfileData extends BodyProfile {
  birthDate?: string | null;
  birthHour?: number | null;
  updatedAt?: string | null;
}

/**
 * Height/weight/body-fat, used both as the first-run prompt and as the page
 * where they're edited later. `compact` drops the surrounding chrome so the
 * onboarding screen can wrap it in its own framing.
 */
export default function ProfileForm({
  profile,
  onSaved,
  onSkip,
  compact = false,
  suggestedWeight,
}: {
  profile: ProfileData;
  onSaved: (p: ProfileData) => void;
  onSkip?: () => void;
  compact?: boolean;
  /** Latest weight seen in the health data, offered as a starting point. */
  suggestedWeight?: number | null;
}) {
  const [height, setHeight] = useState(profile.heightCm?.toString() ?? "");
  const [weight, setWeight] = useState(
    profile.weightKg?.toString() ?? suggestedWeight?.toFixed(1) ?? "",
  );
  const [fat, setFat] = useState(profile.bodyFatPct?.toString() ?? "");
  const [date, setDate] = useState(profile.birthDate ?? "");
  const [hour, setHour] = useState(profile.birthHour?.toString() ?? "");
  const [sex, setSex] = useState<string>(profile.sex ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSavedNote(false);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heightCm: height === "" ? undefined : Number(height),
          weightKg: weight === "" ? undefined : Number(weight),
          bodyFatPct: fat === "" ? null : Number(fat),
          birthDate: date === "" ? null : date,
          birthHour: hour === "" ? null : Number(hour),
          sex: sex === "" ? null : sex,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `保存失败 (${res.status})`);
        return;
      }
      setSavedNote(true);
      onSaved(j.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const live: BodyProfile = {
    heightCm: height === "" ? null : Number(height),
    weightKg: weight === "" ? null : Number(weight),
    bodyFatPct: fat === "" ? null : Number(fat),
    birthYear: date !== "" ? Number(date.slice(0, 4)) : profile.birthYear,
    sex: sex === "" ? null : sex,
  };
  const b = bmi(live);
  const f = bodyFatReading(live);
  const rest = bmr(live);
  const maxHr = hrMax(live);

  const body = (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="身高"
          unit="cm"
          value={height}
          onChange={setHeight}
          placeholder="175"
          required
        />
        <Field
          label="体重"
          unit="kg"
          value={weight}
          onChange={setWeight}
          placeholder="70"
          required
          hint={
            suggestedWeight != null && profile.weightKg == null
              ? `健康 App 里最近是 ${suggestedWeight.toFixed(1)}`
              : undefined
          }
        />
        <Field
          label="体脂率"
          unit="%"
          value={fat}
          onChange={setFat}
          placeholder="选填"
          hint="不知道就留空，体脂秤或健身房测的都行"
        />
        <label className="block">
          <span className="mb-1.5 block text-xs text-zinc-500">出生日期（选填）</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:text-zinc-100"
          />
          <span className="mt-1 block text-[11px] text-zinc-400">用于按年龄给参考范围，也用于「传统」页的八字排盘</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-zinc-500">出生时辰（选填）</span>
          <select
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            <option value="">不知道</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{`${h}:00 - ${h}:59`}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-zinc-400">不知道就留空，排盘会少一柱但不影响其他</span>
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-xs text-zinc-500">性别（选填，用于参考范围）</span>
        <div className="flex gap-2">
          {[
            { v: "male", t: "男" },
            { v: "female", t: "女" },
            { v: "", t: "不填" },
          ].map((o) => (
            <button
              key={o.v || "none"}
              type="button"
              onClick={() => setSex(o.v)}
              className={`rounded-lg border px-4 py-1.5 text-sm transition ${
                sex === o.v
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {o.t}
            </button>
          ))}
        </div>
      </div>

      {(b || f || rest) && (
        <div className="space-y-2 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800/50">
          <p className="text-xs font-medium text-zinc-500">根据你填的算出来</p>
          {b && <ReadingRow name="BMI（体重身高比）" reading={b} />}
          {f && <ReadingRow name="体脂率" reading={f} suffix="%" />}
          {rest && (
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              <span className="text-zinc-500">基础代谢</span>{" "}
              <b className="tabular-nums">{rest}</b> 千卡/天
              <span className="ml-1 text-xs text-zinc-400">· 什么都不做也会消耗的热量</span>
            </p>
          )}
          {maxHr && (
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              <span className="text-zinc-500">估算最大心率</span>{" "}
              <b className="tabular-nums">{maxHr}</b> 次/分
              <span className="ml-1 text-xs text-zinc-400">· 用来划分运动强度区间</span>
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      {savedNote && !error && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">已保存 ✓</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || height === "" || weight === ""}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-700"
          >
            以后再填
          </button>
        )}
      </div>
    </form>
  );

  if (compact) return body;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {body}
      {profile.updatedAt && (
        <p className="mt-4 text-[11px] text-zinc-400">
          上次更新：{profile.updatedAt.slice(0, 10)}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  placeholder,
  hint,
  required,
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-zinc-500">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 focus-within:border-emerald-500 dark:border-zinc-700">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm tabular-nums text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        {unit && <span className="shrink-0 text-xs text-zinc-400">{unit}</span>}
      </div>
      {hint && <span className="mt-1 block text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}

function ReadingRow({
  name,
  reading,
  suffix = "",
}: {
  name: string;
  reading: { value: number; label: string; detail: string; level: string };
  suffix?: string;
}) {
  return (
    <div className="text-sm">
      <span className="text-zinc-500">{name}</span>{" "}
      <b className="tabular-nums text-zinc-900 dark:text-zinc-50">
        {reading.value}
        {suffix}
      </b>
      <span
        className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
        style={{ backgroundColor: LEVEL_COLOR[reading.level as keyof typeof LEVEL_COLOR] }}
      >
        {reading.label}
      </span>
      <p className="mt-0.5 text-xs leading-5 text-zinc-500">{reading.detail}</p>
    </div>
  );
}
