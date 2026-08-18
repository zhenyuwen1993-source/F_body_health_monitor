"use client";

import { useMemo } from "react";
import { useSession } from "./AuthGate";
import type { HealthDataset } from "@/lib/health";
import {
  BAZI_CLOSING,
  BAZI_DISCLAIMER,
  computeBazi,
  dayMasterTip,
  tcmHints,
  todayReading,
} from "@/lib/health/bazi";

/**
 * 传统养生视角：八字 + 中医体质，始终与实际测量数据对照展示。
 * 定位是文化参考——两边冲突时，页面明说以数据为准。
 */
export default function TraditionTab({
  data,
  onGoBody,
}: {
  data: HealthDataset;
  onGoBody: () => void;
}) {
  const { profile } = useSession();
  const chart = useMemo(
    () =>
      profile.birthDate ? computeBazi(profile.birthDate, profile.birthHour ?? null) : null,
    [profile.birthDate, profile.birthHour],
  );
  const today = data.daily[data.daily.length - 1];
  const reading = useMemo(() => (chart ? todayReading(chart, today) : null), [chart, today]);
  const hints = useMemo(() => tcmHints(data), [data]);

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-500 dark:bg-zinc-900">
        {BAZI_DISCLAIMER}
      </p>

      {/* 八字 */}
      {!chart ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            排八字需要你的出生日期（时辰可选）。
          </p>
          <button
            onClick={onGoBody}
            className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-zinc-900"
          >
            去「我的身体」填一下
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">你的八字</h3>
              <span className="text-xs text-zinc-400">{chart.lunarDate}</span>
            </div>
            <p className="mt-3 text-center text-2xl font-semibold tracking-[0.3em] text-zinc-900 dark:text-zinc-50">
              {chart.pillars}
            </p>
            {!chart.hourKnown && (
              <p className="mt-1 text-center text-[11px] text-zinc-400">
                未填出生时辰，缺时柱；在「我的身体」补上可排全四柱
              </p>
            )}
            <div className="mt-4 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <p className="text-sm text-zinc-700 dark:text-zinc-200">
                <b>
                  日主 {chart.dayMaster}
                  {chart.dayMasterElement}
                </b>
              </p>
              <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {dayMasterTip(chart.dayMaster)}
              </p>
            </div>
          </div>

          {reading && (
            <div
              className={`rounded-xl border p-5 ${
                reading.agree
                  ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                今日对照 · {reading.todayPillar}日（{reading.relation}）
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {reading.traditional}
              </p>
              <p className="mt-2 text-sm leading-6 font-medium text-zinc-800 dark:text-zinc-100">
                {reading.combined}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 中医体质倾向 */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          中医养生视角
        </h3>
        <p className="mt-0.5 text-xs text-zinc-400">根据你最近的睡眠、心率和活动数据触发。</p>
        <ul className="mt-3 space-y-2">
          {hints.map((h, i) => (
            <li
              key={i}
              className={`text-sm leading-6 ${
                i === 0 || i === hints.length - 1
                  ? "text-xs text-zinc-400"
                  : "text-zinc-700 dark:text-zinc-200"
              }`}
            >
              {i === 0 || i === hints.length - 1 ? h : `· ${h}`}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-center text-xs text-zinc-400">{BAZI_CLOSING}</p>
    </div>
  );
}
