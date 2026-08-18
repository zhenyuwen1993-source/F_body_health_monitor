// 传统养生视角：八字 + 中医体质倾向，与实际健康数据对照。
//
// The ten day-master tips and the TCM constitution rules are carried over
// verbatim from the original Python advice module. The framing rule also
// carries over: tradition is a cultural lens, and whenever it disagrees with
// the measured data, the data wins — the copy says so explicitly.

import { Solar } from "lunar-typescript";
import type { DailyMetrics, HealthDataset } from "./types";

export interface BaziChart {
  pillars: string; // 四柱（时辰未知时为三柱）
  dayMaster: string; // 日主天干
  dayMasterElement: string; // 木火土金水
  hourKnown: boolean;
  lunarDate: string;
}

// 天干 → 五行
const GAN_ELEMENT: Record<string, string> = {
  甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土",
  己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水",
};

// 相生：木→火→土→金→水→木；相克：木土水火金木
const GENERATES: Record<string, string> = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const OVERCOMES: Record<string, string> = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

/** 原 Python 版 _day_master_tips，逐字保留。 */
const DAY_MASTER_TIPS: Record<string, string> = {
  甲: "日主甲木：宜有规律伸展与户外，忌长期压抑不动；训练注重节奏而非蛮干。",
  乙: "日主乙木：适合柔韧、持续有氧；压力大时用散步疏肝，避免闷头硬扛。",
  丙: "日主丙火：精力外放，注意别过午后还高强度；护睡眠即护「火神」。",
  丁: "日主丁火：细火慢功型，适合技术练习；睡眠与情绪波动时减刺激。",
  戊: "日主戊土：稳扎稳打，恢复日也要真正停高强度；饮食规律比极端饮食更合适。",
  己: "日主己土：重脾胃作息，少暴饮暴食与深夜进食；训练循序渐进。",
  庚: "日主庚金：执行力强但易过度，必须设置强制轻松日，防「透支硬刚」。",
  辛: "日主辛金：精细恢复很重要，睡眠与放松仪式感能帮你保持锋芒。",
  壬: "日主壬水：流动变化大，固定睡眠锚点；水性喜动，但忌连续大负荷不休。",
  癸: "日主癸水：怕耗阴，晚睡杀伤大；偏好温和有氧与规律早睡。",
};

export const BAZI_DISCLAIMER =
  "生辰八字仅作传统文化作息/性情参考，与健康数据交叉时请保持审慎，不作命运或医疗判断。";
export const BAZI_CLOSING =
  "八字参考应让位于客观指标：HRV/睡眠/TSB 明显差时，优先休息，不因「今日宜练」硬上。";

export function computeBazi(birthDate: string, birthHour: number | null): BaziChart | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  try {
    const hourKnown = birthHour != null;
    const solar = Solar.fromYmdHms(
      Number(m[1]), Number(m[2]), Number(m[3]), birthHour ?? 12, 0, 0,
    );
    const lunar = solar.getLunar();
    const ec = lunar.getEightChar();
    const dayMaster = ec.getDayGan();
    const pillars = hourKnown
      ? `${ec.getYear()} ${ec.getMonth()} ${ec.getDay()} ${ec.getTime()}`
      : `${ec.getYear()} ${ec.getMonth()} ${ec.getDay()}`;
    return {
      pillars,
      dayMaster,
      dayMasterElement: GAN_ELEMENT[dayMaster] ?? "",
      hourKnown,
      lunarDate: lunar.toString(),
    };
  } catch {
    return null;
  }
}

export function dayMasterTip(dayMaster: string): string {
  return (
    DAY_MASTER_TIPS[dayMaster] ??
    "已排盘，但日主未识别到常用天干映射；仍以客观恢复指标为主。"
  );
}

// --- 今日对照：传统的说法 vs 身体的数据 --------------------------------------

export interface DailyReading {
  todayPillar: string; // 今日日柱
  relation: string; // 十神大类
  traditional: string; // 传统视角一句话
  combined: string; // 与今日身体数据对照后的结论
  agree: boolean;
}

const RELATION_TEXT: Record<string, { name: string; text: string; restful: boolean }> = {
  peer: { name: "比劫日", text: "传统视角：帮身之日，适合按既定计划推进、与人协作。", restful: false },
  output: { name: "食伤日", text: "传统视角：输出之日，适合表达、创作、社交与舒展。", restful: false },
  wealth: { name: "财日", text: "传统视角：执行之日，适合处理具体事务、见人谈事。", restful: false },
  officer: { name: "官杀日", text: "传统视角：约束之日，宜稳不宜冲，少硬碰硬。", restful: true },
  resource: { name: "印日", text: "传统视角：滋养之日，适合学习、休整、恢复精力。", restful: true },
};

export function todayReading(
  chart: BaziChart,
  todayMetrics: DailyMetrics | undefined,
): DailyReading {
  const ec = Solar.fromDate(new Date()).getLunar().getEightChar();
  const todayGan = ec.getDayGan();
  const me = chart.dayMasterElement;
  const it = GAN_ELEMENT[todayGan] ?? "";

  let key: keyof typeof RELATION_TEXT = "peer";
  if (it === me) key = "peer";
  else if (GENERATES[me] === it) key = "output";
  else if (OVERCOMES[me] === it) key = "wealth";
  else if (OVERCOMES[it] === me) key = "officer";
  else if (GENERATES[it] === me) key = "resource";

  const rel = RELATION_TEXT[key];
  const readiness = todayMetrics?.readiness;

  let combined: string;
  let agree = false;
  if (readiness == null) {
    combined = "今天还没有足够的身体数据，传统说法仅供一乐。";
  } else if (rel.restful && readiness < 55) {
    agree = true;
    combined = `难得一致：传统视角建议收着点，你的身体数据（状态 ${readiness} 分）也是同一个意思——今天就顺势休整。`;
  } else if (!rel.restful && readiness >= 73) {
    agree = true;
    combined = `身心同频：传统视角支持行动，你的身体数据（状态 ${readiness} 分）也在线——想做的事今天做。`;
  } else if (!rel.restful && readiness < 55) {
    combined = `两边打架了：黄历说宜动，但你的身体数据（状态 ${readiness} 分）明确说该歇。听身体的。`;
  } else if (rel.restful && readiness >= 73) {
    combined = `传统视角偏保守，但你的身体今天状态很好（${readiness} 分）。数据优先——该练就练，注意别硬碰硬地冲突就好。`;
  } else {
    combined = `今天两边都中性：正常安排，别刻意加码也别刻意躺平。（状态 ${readiness} 分）`;
  }

  return {
    todayPillar: ec.getDay(),
    relation: rel.name,
    traditional: rel.text,
    combined,
    agree,
  };
}

// --- 中医体质倾向（原版规则，触发条件接到真实数据上） -------------------------

export function tcmHints(data: HealthDataset): string[] {
  const days = data.daily;
  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  const base = data.baselines;

  const sleepMissing =
    (last?.sleep_asleep ?? last?.sleep_inbed) == null &&
    (prev?.sleep_asleep ?? prev?.sleep_inbed) == null;
  const hrvLow =
    last?.hrv != null && base.hrv != null && last.hrv < base.hrv * 0.85;
  const tsbLow = (last?.tsb ?? 0) < -5;
  const rhr = last?.resting_hr;
  const steps = last?.steps;
  const mood = last?.mood;

  const out: string[] = [
    "以下为中医体质/养生视角的「倾向观察」，只供生活调养参考，不能替代中医师面诊。",
  ];
  if (sleepMissing || hrvLow || tsbLow)
    out.push(
      "倾向「气虚/阴不足」样态（疲劳累积、恢复慢）：少耗散、早睡、避免大汗淋漓的死磕训练；可偏温润饮食（粥、蛋、蔬果），少冰饮。",
    );
  if (rhr != null && rhr >= 70 && mood != null && mood < 3.3)
    out.push(
      "心神偏亢/压力样信号：减少夜间兴奋性刺激（咖啡、激烈比赛回放、刷短视频），可练安神呼吸或短暂冥想。",
    );
  if (steps != null && steps < 4000 && mood != null && mood < 3.2)
    out.push(
      "「久坐气滞」样：每小时起身、饭后缓行；情志上避免闷在室内，短户外比硬练更合适。",
    );
  if (steps != null && steps >= 7000 && tsbLow)
    out.push(
      "动得不少但恢复不够：中医说「形劳则气耗」——活动改为和缓，重点养神与睡眠，而不是再加量。",
    );
  const hour = new Date().getHours();
  if (hour >= 21 || hour < 5)
    out.push("子时前后宜渐静：若还在强光/训练，易耗阴血；尽量进入洗漱-暗光-上床流程。");
  else
    out.push("白天可「微微取汗」式活动（轻走）疏通气机，但以不端着累进下一场高强度为准。");
  out.push("若要系统中医调理，请携带症状与作息记录线下就诊；此处不做方药推荐。");
  return out;
}
