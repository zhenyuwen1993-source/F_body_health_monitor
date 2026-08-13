"use client";

import { useLocalFlag } from "@/lib/useLocalFlag";
import TrainingPlanner from "@/components/dashboard/TrainingPlanner";
import WorkoutAnalysis from "@/components/dashboard/WorkoutAnalysis";
import type { HealthDataset } from "@/lib/health";

const KEY = "striortus:fitnessMode";

/**
 * Lifting-specific tooling, off by default. Most people opening this page just
 * want to know how they slept; the plan/actual log and per-muscle recovery only
 * make sense if you train that way, so it's opt-in and remembered per device.
 */
export default function FitnessSection({ data }: { data: HealthDataset }) {
  const [on, set] = useLocalFlag(KEY);

  return (
    <section className="mt-8">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">健身模式</h2>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">
            记录每天打算练哪些部位、实际练了什么、哪里不舒服，再结合身体状态告诉你今天该不该按计划来。不健身的话可以关掉。
          </p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="健身模式"
          onClick={() => set(!on)}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition ${
            on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              on ? "left-[1.375rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {on && (
        <div className="mt-5 space-y-8">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              今天练什么
            </h3>
            <TrainingPlanner data={data} />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              运动强度分析
            </h3>
            <WorkoutAnalysis data={data} />
          </div>
        </div>
      )}
    </section>
  );
}
