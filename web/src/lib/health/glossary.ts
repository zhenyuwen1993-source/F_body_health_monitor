// Plain-language explanations for every metric we surface.
//
// Ported verbatim from src/web/glossary.py — the Chinese copy was already
// written for non-specialists, so it carries over unchanged.

export interface MetricInfo {
  key: string;
  name: string;
  what: string;
  why: string;
  healthy: string;
  unit?: string;
  notes?: string;
}

export const DISCLAIMER_SHORT =
  "参考区间仅供个人观察，非医疗诊断；个体基线更重要。";

export const GLOSSARY: Record<string, MetricInfo> = {
  training_readiness: {
    key: "training_readiness",
    name: "今日状态",
    what: "综合睡眠、HRV 状态、近期训练负荷、恢复时间、静息心率等，算出的 0–100 分，回答「今天能不能好好练」。",
    why: "比单看步数或睡眠更贴近实际决策——告诉你今天该冲还是该歇。",
    healthy: "≥73 可以正常练；55–72 适合轻中强度；35–54 建议放轻松；<35 优先休息。",
    unit: "/100",
    notes: "本地估算，不是医疗或专业运动评估。",
  },
  recovery_pct: {
    key: "recovery_pct",
    name: "恢复程度",
    what: "早上醒来时身体恢复了多少。主要看心率变异性（HRV）和静息心率相对你自己基线的变化，再结合睡眠。",
    why: "回答「昨天的疲劳消化掉了吗」。绿灯可以冲，黄灯维持，红灯该恢复。",
    healthy: "≥67% 状态好；34–66% 一般；<34% 需要恢复。看趋势比看单日更有意义。",
    unit: "%",
  },
  strain: {
    key: "strain",
    name: "今日消耗",
    what: "当天身体承受的总负荷，用心率数据积分算出，映射到 0–21 的刻度。",
    why: "衡量「今天已经花掉了多少体力」，配合恢复程度决定还能不能继续练。",
    healthy: "没有绝对好坏，要对照当天状态。轻松日通常 <8，大运动量日可能 >14。",
    unit: "/21",
  },
  sleep_hours: {
    key: "sleep_hours",
    name: "睡眠时长",
    what: "当晚真正睡着的时间合计（深睡+核心+REM 等），不是躺床时间。",
    why: "成年人多数需要足够连续睡眠；长期过短会累积疲劳。",
    healthy: "成人常见参考约 7–9 小时；<6 小时偏短，>10 小时也需结合自身情况。",
    unit: "小时",
    notes: "需夜间佩戴手表才有分期数据。",
  },
  sleep_deep_hours: {
    key: "sleep_deep_hours",
    name: "深睡",
    what: "深度睡眠阶段，身体修复、生长激素分泌更活跃的时段。",
    why: "深睡不足常感觉「睡了但不清醒」。",
    healthy: "因人而异；常见大约占总睡眠的 10–25%（约 0.5–2 小时量级）。",
    unit: "小时",
  },
  sleep_rem_hours: {
    key: "sleep_rem_hours",
    name: "快速眼动睡眠（REM）",
    what: "快速眼动睡眠，与记忆巩固、情绪调节关系较大。",
    why: "REM 偏少时，有人会感觉情绪更易波动、白天不清爽。",
    healthy: "常见大约占总睡眠 20–25% 左右（个体差异大）。",
    unit: "小时",
  },
  sleep_core_hours: {
    key: "sleep_core_hours",
    name: "核心睡眠",
    what: "Apple 对浅–中等深度睡眠阶段的归类（Core），介于深睡与 REM 之间的主要睡眠体。",
    why: "占总睡眠大部分；单独解读意义有限，更宜看整晚结构。",
    healthy: "通常占睡眠大部分；重点仍看总时长与深睡/REM 比例是否异常偏移。",
    unit: "小时",
  },
  sleep_consistency: {
    key: "sleep_consistency",
    name: "作息规律度",
    what: "近几天入睡/醒来时间是否稳定（0–100，越高越规律）。",
    why: "作息乱（今天 1 点睡、明天 10 点睡）会打乱生物钟，即使总时长够也可能难受。",
    healthy: "≥70 较规律；经常 <45 建议固定入睡窗口（例如每天 ±30 分钟内）。",
    unit: "/100",
  },
  resting_hr: {
    key: "resting_hr",
    name: "静息心率",
    what: "安静休息时的心跳次数（次/分钟）。手表通常取白天较安静时段的估计值。",
    why: "相对你自己的基线：持续升高可能与疲劳、压力、生病、睡眠差有关。",
    healthy:
      "成人常见大约 60–100 次/分；经常锻炼者常可到 50–60。更重要是对比你自己的常态。",
    unit: "次/分",
    notes: "突然比个人基线高一截，先休息观察；持续异常再咨询医生。",
  },
  hrv_sdnn_ms: {
    key: "hrv_sdnn_ms",
    name: "心率变异性（HRV）",
    what: "相邻两次心跳间隔的变化程度。数值通常越高，说明身体的自主神经调节越「有弹性」、越放松。",
    why: "压力大、睡眠差、生病、练太猛时，HRV 常会下降；恢复好时往往回升。它是恢复与压力的敏感信号，不是疾病诊断。",
    healthy:
      "没有人人通用的「及格线」，个体差异很大。请以你自己近 2–4 周的中位数为基线：明显高于基线是好事，持续低于基线约 15–20% 就要关注恢复。",
    unit: "毫秒",
    notes: "不同设备/时段测的数值不能直接比。本页已经相对你的个人基线做过换算。",
  },
  spo2_avg: {
    key: "spo2_avg",
    name: "血氧",
    what: "血液中血红蛋白携带氧气的大致比例（SpO₂）。",
    why: "过低可能与呼吸、海拔、测量误差有关；偶发偏低先排除手冷/佩戴松。",
    healthy: "健康成人安静时常见约 95–100%；持续 <92%（在海平面）应更重视并咨询专业人士。",
    unit: "%",
    notes: "手表血氧是抽检，精度不如医用指夹。",
  },
  steps: {
    key: "steps",
    name: "步数",
    what: "当天走路步数（已按手表优先去重，避免手机重复计算）。",
    why: "日常活动量的简单代理指标，和代谢、情绪都有关系。",
    healthy: "常见倡议约 7000–10000 步/日；不是铁律。能从你当前基线逐步增加更重要。",
    unit: "步",
  },
  active_energy_kcal: {
    key: "active_energy_kcal",
    name: "活动消耗",
    what: "因活动额外消耗的热量（不含维持生命的基础代谢）。",
    why: "比步数更能概括「今天动得有多猛」。",
    healthy: "因体重与目标而异；可对比自己的周均值。苹果三环里的「活动」对应这类指标。",
    unit: "千卡",
  },
  exercise_minutes: {
    key: "exercise_minutes",
    name: "锻炼时间",
    what: "达到一定强度的运动分钟数（对应 Apple「锻炼」环）。",
    why: "中等以上强度活动对心肺更有效；和「随便走走」有区别。",
    healthy:
      "世卫对成人常见建议是每周约 150 分钟中等强度活动（约合每天 20–30 分钟），可分散完成。",
    unit: "分钟",
  },
  weight_kg: {
    key: "weight_kg",
    name: "体重",
    what: "身体重量。",
    why: "长期趋势比单日数字重要（饮食、水分会造成公斤级波动）。",
    healthy: "看趋势和腰围、体脂、体能，比只盯某个数字更有意义。",
    unit: "kg",
  },
  mood_score: {
    key: "mood_score",
    name: "心情",
    what: "1–5 分的情绪观察：优先用健康 App 里的「心态」记录；没有的话根据睡眠/恢复/活动推断。",
    why: "主观感受是健康的重要一环；长期偏低要重视休息与身边的支持。",
    healthy: "大致：≥4 较好；3 左右平稳；经常 ≤2.5 建议多关注睡眠、压力，必要时找人聊聊或寻求专业帮助。",
    unit: "/5",
    notes: "推断分不等于你的真实感受，建议尽量在健康 App 里打卡心态。",
  },
  ctl: {
    key: "ctl",
    name: "体能储备",
    what: "过去约 6 周训练量的平滑平均，代表你长期积累下来的「底子」。专业上叫 CTL。",
    why: "慢慢升高通常表示体能在进步；涨太快也可能伴随疲劳。",
    healthy: "没有绝对标准；稳定缓升比忽高忽低好。",
  },
  atl: {
    key: "atl",
    name: "近期疲劳",
    what: "过去约 1 周训练量的平均，代表最近堆积的疲劳。专业上叫 ATL。",
    why: "短期练太猛时会抬升；需要靠轻松日把它降下来。",
    healthy: "持续明显高于「体能储备」时，通常就会觉得累。",
  },
  tsb: {
    key: "tsb",
    name: "身体余力",
    what: "体能储备减去近期疲劳。正数表示身体还有余力，负数表示疲劳没消化完。专业上叫 TSB。",
    why: "用来安排什么时候冲、什么时候歇：余力很负的时候硬上高强度，容易表现差或受伤。",
    healthy: "大致：>0 比较有余力；-10～0 适合中等强度；经常低于 -10 建议减量。",
  },
  hr_zone: {
    key: "hr_zone",
    name: "心率区间",
    what: "用平均心率相对你的预估最大心率，划分成 Z1–Z5 五档强度。",
    why: "帮你区分「恢复课」和「硬课」，避免天天都在高强度区却以为自己在轻松练。",
    healthy: "多数时间建议在 Z1–Z2，少量 Z3–Z4；Z5 宜短。",
  },
};

/** Look up by our internal metric key, tolerating a few aliases. */
const ALIASES: Record<string, string> = {
  readiness: "training_readiness",
  recovery: "recovery_pct",
  sleep_asleep: "sleep_hours",
  sleep_inbed: "sleep_hours",
  sleep_deep: "sleep_deep_hours",
  sleep_rem: "sleep_rem_hours",
  sleep_core: "sleep_core_hours",
  hrv: "hrv_sdnn_ms",
  spo2: "spo2_avg",
  active_energy: "active_energy_kcal",
  exercise: "exercise_minutes",
  weight: "weight_kg",
  mood: "mood_score",
};

export function metricInfo(key: string): MetricInfo | undefined {
  return GLOSSARY[key] ?? GLOSSARY[ALIASES[key] ?? ""];
}
