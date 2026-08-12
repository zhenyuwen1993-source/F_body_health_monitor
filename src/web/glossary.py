"""Metric glossary: plain-language explanations and general reference ranges.

These are population-oriented educational ranges for personal observation,
NOT medical diagnosis thresholds. Individual baselines matter more.
"""

from __future__ import annotations

from dataclasses import dataclass


DISCLAIMER_SHORT = "参考区间仅供个人观察，非医疗诊断；个体基线更重要。"


@dataclass(frozen=True)
class MetricInfo:
    key: str
    name: str
    what: str
    why: str
    healthy: str
    unit: str = ""
    notes: str = ""


GLOSSARY: dict[str, MetricInfo] = {
    "overall_score": MetricInfo(
        key="overall_score",
        name="综合分",
        what="把恢复、活动、睡眠、心情等当天观察合成的 0–100 分，方便一眼看整体状态。",
        why="单项指标有时互相矛盾（例如步数很多但 HRV 很低），综合分帮你快速抓重点。",
        healthy="大致：≥70 较稳；45–70 一般；<45 需多留意睡眠/恢复/压力。",
        unit="/100",
        notes="本系统自研评分，不是医院量表。",
    ),
    "recovery_score": MetricInfo(
        key="recovery_score",
        name="恢复分",
        what="综合睡眠、HRV、静息心率、训练状态（TSB）等，估计身体是否从负荷中恢复过来。",
        why="恢复不足时硬练，容易越练越累、心情与睡眠也变差。",
        healthy="≥70 恢复较好；45–70 一般；<45 建议减强度或早点睡。",
        unit="/100",
    ),
    "activity_score": MetricInfo(
        key="activity_score",
        name="活动分",
        what="相对你自己基线，看步数、活动热量、锻炼分钟是否够活跃。",
        why="适度活动有助于代谢、情绪与睡眠；过低或突然过高都值得注意。",
        healthy="≥70 活跃度不错；长期 <45 可考虑增加步行。",
        unit="/100",
    ),
    "sleep_score": MetricInfo(
        key="sleep_score",
        name="睡眠分",
        what="结合睡眠时长与作息一致性等，对当晚/近期睡眠质量的观察分。",
        why="睡眠是恢复的底盘，短期欠债常会反映在心率、HRV 与心情上。",
        healthy="≥70 较理想；经常 <45 优先固定入睡时间。",
        unit="/100",
    ),
    "sleep_hours": MetricInfo(
        key="sleep_hours",
        name="睡眠时长",
        what="当晚真正睡着的时间合计（深睡+核心+REM 等），不是躺床时间。",
        why="成年人多数需要足够连续睡眠；长期过短会累积疲劳。",
        healthy="成人常见参考约 7–9 小时；<6 小时偏短，>10 小时也需结合自身情况。",
        unit="小时",
        notes="需夜间佩戴手表才有分期数据。",
    ),
    "sleep_deep_hours": MetricInfo(
        key="sleep_deep_hours",
        name="深睡",
        what="深度睡眠阶段，身体修复、生长激素分泌更活跃的时段。",
        why="深睡不足常感觉「睡了但不清醒」。",
        healthy="因人而异；常见大约占总睡眠的 10–25%（约 0.5–2 小时量级）。",
        unit="小时",
    ),
    "sleep_rem_hours": MetricInfo(
        key="sleep_rem_hours",
        name="REM 睡眠",
        what="快速眼动睡眠，与记忆巩固、情绪调节关系较大。",
        why="REM 偏少时，有人会感觉情绪更易波动、白天不清爽。",
        healthy="常见大约占总睡眠 20–25% 左右（个体差异大）。",
        unit="小时",
    ),
    "sleep_core_hours": MetricInfo(
        key="sleep_core_hours",
        name="核心睡眠",
        what="Apple 对浅–中等深度睡眠阶段的归类（Core），介于深睡与 REM 之间的主要睡眠体。",
        why="占总睡眠大部分；单独解读意义有限，更宜看整晚结构。",
        healthy="通常占睡眠大部分；重点仍看总时长与深睡/REM 比例是否异常偏移。",
        unit="小时",
    ),
    "sleep_consistency": MetricInfo(
        key="sleep_consistency",
        name="睡眠一致性",
        what="近几天入睡/醒来时间是否稳定（0–100，越高越规律）。",
        why="作息乱（今天 1 点睡、明天 10 点睡）会打乱生物钟，即使总时长够也可能难受。",
        healthy="≥70 较规律；经常 <45 建议固定入睡窗口（例如每天 ±30 分钟内）。",
        unit="/100",
    ),
    "resting_hr": MetricInfo(
        key="resting_hr",
        name="静息心率",
        what="安静休息时的心跳次数（次/分钟）。手表通常取白天较安静时段的估计值。",
        why="相对你自己的基线：持续升高可能与疲劳、压力、生病、睡眠差有关。",
        healthy="成人常见大约 60–100 bpm；经常锻炼者常可到 50–60。更重要是对比你自己的常态。",
        unit="bpm",
        notes="突然比个人基线高一截，先休息观察；持续异常再咨询医生。",
    ),
    "avg_hr": MetricInfo(
        key="avg_hr",
        name="平均心率",
        what="当天采样到的心率平均值，包含走路、坐着、运动等混合场景。",
        why="反映当天整体心血管负荷，但受运动多少影响很大，不宜单独当「健康分数」。",
        healthy="无单一「健康均值」；久坐日往往更低，训练日更高。结合静息心率与运动记录看。",
        unit="bpm",
    ),
    "walking_hr_avg": MetricInfo(
        key="walking_hr_avg",
        name="步行平均心率",
        what="走路时的平均心率，反映日常步行强度与心肺负担。",
        why="同样配速下若明显偏高，可能与疲劳、炎热、体能下降有关。",
        healthy="因配速与体能而异；更宜和自己历史步行心率比。",
        unit="bpm",
    ),
    "hrv_sdnn_ms": MetricInfo(
        key="hrv_sdnn_ms",
        name="HRV（心率变异性）",
        what=(
            "Heart Rate Variability：相邻心跳间隔的变化程度。"
            "本系统用 SDNN（毫秒）：数值通常越高，自主神经调节越「有弹性」。"
        ),
        why=(
            "压力大、睡眠差、生病、过度训练时，HRV 常会下降；"
            "恢复好时往往回升。它是恢复与压力的敏感观察指标，不是疾病诊断。"
        ),
        healthy=(
            "没有人人通用的「及格线」。成人白天/夜间测量差异很大，常见报道跨度约数十毫秒。"
            "请以你自己近 2–4 周中位数为基线：明显高于基线偏积极，持续低于基线约 15–20% 需关注恢复。"
        ),
        unit="ms",
        notes="不同设备/时段不可硬比。本页已相对你的个人基线做观察。",
    ),
    "spo2_avg": MetricInfo(
        key="spo2_avg",
        name="血氧饱和度",
        what="血液中血红蛋白携带氧气的大致比例（SpO₂）。",
        why="过低可能与呼吸、海拔、测量误差有关；偶发偏低先排除手冷/佩戴松。",
        healthy="健康成人安静时常见约 95–100%；持续 <92%（在海平面）应更重视并咨询专业人士。",
        unit="%",
        notes="手表血氧是抽检，精度不如医用指夹。",
    ),
    "steps": MetricInfo(
        key="steps",
        name="步数",
        what="当天走路步数（本系统已按 Watch 优先去重，减少手机重复计算）。",
        why="日常活动量的简单代理指标，和代谢、情绪都有关系。",
        healthy="常见倡议约 7000–10000 步/日；不是铁律。能从你当前基线逐步增加更重要。",
        unit="步",
    ),
    "distance_km": MetricInfo(
        key="distance_km",
        name="步行+跑步距离",
        what="估算的步行/跑步距离。",
        why="比纯步数更能反映位移量，但仍受步幅估计影响。",
        healthy="无统一标准；结合训练目标看即可。",
        unit="km",
    ),
    "flights_climbed": MetricInfo(
        key="flights_climbed",
        name="爬楼层数",
        what="估算爬了多少层楼（气压/动作推算）。",
        why="反映垂直活动；对腿部与心肺有额外刺激。",
        healthy="无统一标准；城市通勤爬楼也可计入日常活动。",
        unit="层",
    ),
    "active_energy_kcal": MetricInfo(
        key="active_energy_kcal",
        name="活动能量",
        what="因活动额外消耗的热量（不含基础代谢）。",
        why="比步数更能概括「今天动得有多猛」。",
        healthy="因体重与目标而异；可对比自己的周均值。苹果三环里的「活动」对应这类指标。",
        unit="kcal",
    ),
    "basal_energy_kcal": MetricInfo(
        key="basal_energy_kcal",
        name="基础能量",
        what="维持生命基本功能的估计热量消耗（静息代谢相关）。",
        why="主要和体重、性别、年龄有关，日常波动通常小于活动能量。",
        healthy="因人而异；短期暴涨暴跌较少见，更多用于长期体重管理参考。",
        unit="kcal",
    ),
    "exercise_minutes": MetricInfo(
        key="exercise_minutes",
        name="锻炼分钟",
        what="达到一定强度的运动分钟数（Apple「锻炼」环相关）。",
        why="中等以上强度活动对心肺更有效；和「随便走走」有区别。",
        healthy="世卫对成人常见建议是每周约 150 分钟中等强度活动（可折合约每天 ~20–30 分钟），可分散完成。",
        unit="分钟",
    ),
    "stand_hours": MetricInfo(
        key="stand_hours",
        name="站立小时",
        what="一天中有多少个小时里站起来活动过（Apple 站立环）。",
        why="打破久坐；久坐过长与代谢、腰背不适相关。",
        healthy="苹果默认目标常为 12 小时有站立；能做到每小时起来一下就很好。",
        unit="小时",
    ),
    "weight_kg": MetricInfo(
        key="weight_kg",
        name="体重",
        what="身体重量。",
        why="长期趋势比单日数字重要（饮食、水分会造成公斤级波动）。",
        healthy="用 BMI 粗分：约 18.5–24 常见为适宜区间（亚洲标准表述略有不同）；更要看腰围、体脂与体能。",
        unit="kg",
    ),
    "body_fat_pct": MetricInfo(
        key="body_fat_pct",
        name="体脂率",
        what="脂肪占体重的百分比（家用秤多为生物电阻抗估算，误差不小）。",
        why="同样体重，体脂不同健康与运动表现可能差很多。",
        healthy="粗参：男性常见约 10–20%、女性约 18–28% 为较常见讨论区间；设备误差大，看趋势。",
        unit="%",
    ),
    "mindful_minutes": MetricInfo(
        key="mindful_minutes",
        name="正念分钟",
        what="正念/呼吸等正念会话累计时长。",
        why="短时正念有时有助于降压主观压力，但对每个人效果不同。",
        healthy="无硬性标准；每天几分钟坚持也有价值。",
        unit="分钟",
    ),
    "mood_score": MetricInfo(
        key="mood_score",
        name="心情",
        what="1–5 分的情绪观察：优先用健康 App「心态」；没有则根据睡眠/恢复/活动推断。",
        why="主观感受是健康的重要一环；长期偏低要重视休息与支持系统。",
        healthy="大致：≥4 较好；3 左右平稳；经常 ≤2.5 建议多关注睡眠、压力与是否需要倾诉/专业帮助。",
        unit="/5",
        notes="推断分不等于真实感受，请尽量在健康 App 打卡心态。",
    ),
    "workout_count": MetricInfo(
        key="workout_count",
        name="训练次数",
        what="当天记录到的 Workout 次数（跑步、网球、骑行等）。",
        why="训练频率是负荷管理的一部分；连续高次数日要看 TSB/HRV。",
        healthy="无统一标准；看项目与恢复。新手宜循序渐进。",
        unit="次",
    ),
    "workout_minutes": MetricInfo(
        key="workout_minutes",
        name="训练时长",
        what="当天各次 Workout 时长合计。",
        why="时长 × 强度 ≈ 训练刺激；只看时长不够，还要看种类与恢复。",
        healthy="依目标而定；注意连续大时长后安排轻松日。",
        unit="分钟",
    ),
    "training_load": MetricInfo(
        key="training_load",
        name="训练负荷 Load",
        what="把当天训练按时长与项目强度系数折成的负荷分数（本系统估算）。",
        why="方便比较「今天练得有多重」，并用于计算 CTL/ATL/TSB。",
        healthy="没有绝对健康线；应相对你近几周均值看：突然暴涨更需恢复。",
        unit="",
        notes="非功率计/心率 TRIMP 医学级模型，是可解释的简化代理。",
    ),
    "ctl": MetricInfo(
        key="ctl",
        name="CTL（体能）",
        what="Chronic Training Load：约 42 天训练负荷的指数移动平均，代表长期积累的「体能底子」。",
        why="CTL 慢慢升高通常表示能力在建设；涨太快也可能伴随疲劳。",
        healthy="无绝对标准；稳定缓升优于过山车。结合自我感觉与比赛/训练表现。",
        unit="",
    ),
    "atl": MetricInfo(
        key="atl",
        name="ATL（疲劳）",
        what="Acute Training Load：约 7 天负荷均值，代表近期疲劳堆积。",
        why="短期练太猛时 ATL 会抬升；需要轻松日把它降下来。",
        healthy="ATL 持续明显高于 CTL 时，常对应更累、TSB 更负。",
        unit="",
    ),
    "tsb": MetricInfo(
        key="tsb",
        name="TSB（状态）",
        what="Training Stress Balance ≈ CTL − ATL。正值偏「新鲜」，负值偏「疲劳」。",
        why="用来安排强度日/恢复日：很负时硬上高强度更容易表现差或受伤风险感上升。",
        healthy="粗参：>0 较新鲜；-10～0 可维持有氧；经常 ≪ -10 建议减强度。个体差异大。",
        unit="",
        notes="来自耐力训练常用概念，迁移到综合运动时仅作参考。",
    ),
    "hr_avg_workout": MetricInfo(
        key="hr_avg_workout",
        name="训练平均心率",
        what="单场 Workout 期间手表统计的平均心率。",
        why="反映这场训练的整体强度；结合最高心率与时长判断是有氧还是质量课。",
        healthy="按占 HRmax 比例看区间：Z1–Z2 偏恢复/有氧，Z4–Z5 偏高强度。无单一「健康均值」。",
        unit="bpm",
    ),
    "hr_zone": MetricInfo(
        key="hr_zone",
        name="心率区间",
        what="用平均心率相对预估最大心率（HRmax）划分的 Z1–Z5。",
        why="帮你区分恢复课与质量课，避免天天都在阈值区却以为自己在「轻松练」。",
        healthy="多数周建议大部分时间在 Z1–Z2，少量 Z3–Z4；Z5 宜短。具体看目标与恢复。",
        unit="",
    ),
    "training_readiness": MetricInfo(
        key="training_readiness",
        name="训练准备度",
        what="仿 Garmin Training Readiness：综合睡眠、HRV 状态、急性负荷(TSB)、恢复时间、静息心率等的 0–100 晨间分。",
        why="回答「今天能不能硬练」——比单独看步数或综合分更贴近训练决策。",
        healthy="粗参：≥73 就绪可质量课；55–72 尚可有氧/稳态；35–54 偏低宜轻松；<35 优先休息。",
        unit="",
        notes="本地启发式，非 Garmin 官方算法。",
    ),
    "hrv_status": MetricInfo(
        key="hrv_status",
        name="HRV 状态",
        what="今日 HRV 相对个人基线（约 28 天中位数）的状态：偏高 / 平衡 / 偏低 / 明显偏低。",
        why="绝对值因人而异；相对自身基线更能反映自主神经压力。",
        healthy="多数训练日落在「平衡」附近即可；持续「偏低」应减强度。",
        unit="",
    ),
    "body_battery": MetricInfo(
        key="body_battery",
        name="能量近似（Body Battery）",
        what="用睡眠分、HRV、恢复分、TSB 合成的日能量近似，再扣减当日活动/负荷。",
        why="粗看「油箱还剩多少」；Apple 导出无法做到 Garmin 分钟级连续更新。",
        healthy="相对自身趋势看：连续很低说明恢复不足。",
        unit="",
    ),
    "sleep_need": MetricInfo(
        key="sleep_need",
        name="睡眠需求",
        what="按近周训练负荷与疲劳调整的个性化睡眠时长目标，并估算近几日睡眠债。",
        why="负荷高的周往往需要更多睡眠；只盯 8 小时不一定够。",
        healthy="多数人落在 7–9 小时；有睡眠债时优先提前上床。",
        unit="h",
    ),
    "recovery_pct": MetricInfo(
        key="recovery_pct",
        name="Recovery %",
        what="仿 WHOOP/Athlytic：晨间恢复百分比。主要用 HRV(SDNN) 与静息心率相对约 60 天个人基线，并融合 Sleep Performance。",
        why="一觉醒来回答「今天能推多狠」；绿/黄/红对应 perform / maintain / restore。",
        healthy="粗参：≥67% 偏绿可冲击；34–66% 黄灯维持；<34% 红灯恢复。看趋势优于看单日。",
        unit="%",
        notes="Apple 提供 SDNN 而非 rMSSD；与 WHOOP 绝对分不可直接对齐。",
    ),
    "strain": MetricInfo(
        key="strain",
        name="Strain（0–21）",
        what="仿 WHOOP：当日心血管负荷。用 Banister TRIMP（心率储备 HRR）积分导出心率点，映射到 0–21 对数形态；并混入 PhysicalEffort(METs)。",
        why="衡量「今天身体已经花了多少」，配合 Recovery 目标区决定是否继续练。",
        healthy="无绝对健康值；应对照当日目标区。轻松日常 <8，大负荷日可 >14。",
        unit="",
        notes="非实时腕上 Strain；依赖导出心率密度。",
    ),
    "sleep_performance": MetricInfo(
        key="sleep_performance",
        name="Sleep Performance",
        what="实际睡眠相对睡眠需求的完成度，有分期时融入深睡+REM 占比，并参考睡眠一致性。",
        why="把「睡没睡够」产品化，驱动今晚 Sleep Need。",
        healthy="接近 100% 较好；缺分期时仅按时长/需求估算。",
        unit="%",
    ),
    "headphone_db_avg": MetricInfo(
        key="headphone_db_avg",
        name="耳机暴露",
        what="耳机音量相关的平均声级估计（分贝）。",
        why="长期过大音量可能损伤听力。",
        healthy="常见建议：尽量避免长时间 >80 dB；音量越大，安全听的时间越短。",
        unit="dB",
    ),
    "environmental_db_avg": MetricInfo(
        key="environmental_db_avg",
        name="环境声级",
        what="手表测到的环境噪音平均水平。",
        why="长期高噪环境与压力、听力风险相关。",
        healthy="世界卫生组织等讨论中，长期环境噪声常以较低分贝为宜；偶发高峰（地铁等）需结合暴露时长。",
        unit="dB",
    ),
}


# Label aliases used in UI cards
LABEL_TO_KEY = {
    "综合分": "overall_score",
    "综合均值": "overall_score",
    "综合分均值": "overall_score",
    "睡眠 (h)": "sleep_hours",
    "睡眠": "sleep_hours",
    "睡眠均值": "sleep_hours",
    "睡眠均值 (h)": "sleep_hours",
    "HRV": "hrv_sdnn_ms",
    "HRV (ms)": "hrv_sdnn_ms",
    "HRV 均值": "hrv_sdnn_ms",
    "静息心率": "resting_hr",
    "心情 /5": "mood_score",
    "心情": "mood_score",
    "心情均值": "mood_score",
    "步数": "steps",
    "日均步数": "steps",
    "活动热量": "active_energy_kcal",
    "日均活动热量": "active_energy_kcal",
    "活动热量日均": "active_energy_kcal",
    "TSB 状态": "tsb",
    "TSB": "tsb",
    "TSB 均值": "tsb",
    "今日 Load": "training_load",
    "CTL 体能": "ctl",
    "ATL 疲劳": "atl",
    "睡眠一致性": "sleep_consistency",
    "锻炼分钟": "exercise_minutes",
    "锻炼分钟日均": "exercise_minutes",
    "日均锻炼": "exercise_minutes",
    "恢复分": "recovery_score",
    "活动分": "activity_score",
    "睡眠分": "sleep_score",
    "站立小时": "stand_hours",
    "训练次数": "workout_count",
    "训练总次数": "workout_count",
    "训练时长合计": "workout_minutes",
    "场均心率": "hr_avg_workout",
    "触及最高心率": "hr_avg_workout",
    "高强度场次": "hr_zone",
    "轻松有氧场次": "hr_zone",
    "训练准备度": "training_readiness",
    "HRV 状态": "hrv_status",
    "能量/负荷": "body_battery",
    "睡眠分": "sleep_score",
    "Recovery": "recovery_pct",
    "Recovery 恢复度": "recovery_pct",
    "Strain": "strain",
    "Strain 负荷": "strain",
    "Sleep Perf.": "sleep_performance",
    "Sleep": "sleep_performance",
    "Sleep 睡眠": "sleep_performance",
    "准备度": "training_readiness",
    "训练准备度": "training_readiness",
    "目标区": "recovery_pct",
}


def info_for_label(label: str) -> MetricInfo | None:
    key = LABEL_TO_KEY.get(label)
    if key:
        return GLOSSARY.get(key)
    if label in GLOSSARY:
        return GLOSSARY[label]
    for info in GLOSSARY.values():
        if info.name == label or info.name.startswith(label) or label.startswith(info.name[:4]):
            return info
    return None


# Auto-map Chinese display names
for _info in GLOSSARY.values():
    LABEL_TO_KEY.setdefault(_info.name, _info.key)

# English overlays for glossary (fallback to Chinese when missing)
GLOSSARY_EN: dict[str, dict[str, str]] = {
    "recovery_pct": {
        "name": "Recovery %",
        "what": "Morning readiness from HRV (SDNN) and resting HR vs your ~60-day baseline, blended with sleep performance.",
        "why": "High recovery means you can push; low recovery means ease off.",
        "healthy": "Green ≥67% · Yellow 34–66% · Red <34%. Prefer personal baselines over population norms.",
    },
    "strain": {
        "name": "Strain (0–21)",
        "what": "WHOOP-inspired daily cardiovascular load from Banister TRIMP (HR reserve) on a 0–21 log-like scale, mixed with PhysicalEffort (METs).",
        "why": "Shows how much you’ve already spent today; pair with Recovery’s target zone.",
        "healthy": "No absolute healthy value — compare to today’s target. Easy days often <8; hard days may be >14.",
    },
    "sleep_performance": {
        "name": "Sleep Performance",
        "what": "How much of your sleep need you completed; stages deepen the score when available.",
        "why": "Turns “did I sleep enough?” into a % that drives tonight’s sleep need.",
        "healthy": "Near 100% is good; without stages it’s mostly hours vs need.",
    },
    "training_readiness": {
        "name": "Training readiness",
        "what": "Garmin-style composite of sleep, HRV, load, recovery time, stress proxy, and RHR.",
        "why": "Quick go / no-go before hard sessions.",
        "healthy": "≥73 ready · 55–72 ok · <55 keep easy.",
    },
    "hrv_sdnn_ms": {
        "name": "HRV (SDNN)",
        "what": "Heart-rate variability from Apple Health SDNN (not rMSSD).",
        "why": "Often tracks recovery and autonomic balance vs your own baseline.",
        "healthy": "Trend vs personal baseline matters more than a fixed number.",
    },
    "resting_hr": {
        "name": "Resting heart rate",
        "what": "Typical resting HR from Health.",
        "why": "Elevated RHR vs baseline can flag fatigue, illness, or stress.",
        "healthy": "Watch rises ~8% above your baseline.",
    },
    "steps": {
        "name": "Steps",
        "what": "Daily step count.",
        "why": "Everyday movement for metabolic and mood health.",
        "healthy": "Often aim ~7,000–10,000; individualize.",
    },
    "tsb": {
        "name": "TSB (form)",
        "what": "Training Stress Balance ≈ CTL − ATL (freshness).",
        "why": "Positive often fresher; deeply negative suggests accumulated fatigue.",
        "healthy": ">0 fresher · often ≪ -10 → consider easing.",
    },
    "overall_score": {
        "name": "Overall score",
        "what": "0–100 blend of recovery, activity, sleep, mood for a quick glance.",
        "why": "Single metrics can conflict; this summarizes the day.",
        "healthy": "≥70 solid · 45–70 mixed · <45 check sleep/recovery/stress.",
    },
}


def localized_metric(info: MetricInfo, lang: str | None = None) -> MetricInfo:
    """Return a MetricInfo with English fields when lang=en and overlay exists."""
    from src.web.i18n import normalize_lang

    if normalize_lang(lang) != "en":
        return info
    en = GLOSSARY_EN.get(info.key)
    if not en:
        return info
    return MetricInfo(
        key=info.key,
        name=en.get("name", info.name),
        what=en.get("what", info.what),
        why=en.get("why", info.why),
        healthy=en.get("healthy", info.healthy),
        unit=info.unit,
        notes=en.get("notes", info.notes),
    )


# English label aliases
LABEL_TO_KEY.update(
    {
        "Recovery": "recovery_pct",
        "Strain": "strain",
        "Sleep": "sleep_performance",
        "Training readiness": "training_readiness",
        "Resting HR": "resting_hr",
        "Steps": "steps",
        "TSB form": "tsb",
        "Overall score": "overall_score",
        "Avg overall": "overall_score",
        "Avg sleep": "sleep_hours",
        "Avg HRV": "hrv_sdnn_ms",
        "Avg mood": "mood_score",
        "Avg steps": "steps",
        "Total workouts": "workout_count",
    }
)


def render_glossary_markdown(keys: list[str] | None = None, *, lang: str | None = None) -> str:
    from src.web.i18n import get_lang, t

    lang = lang or get_lang()
    items = [GLOSSARY[k] for k in (keys or list(GLOSSARY.keys())) if k in GLOSSARY]
    lines = [
        f"## {t('glossary_title', lang)}",
        "",
        f"> {DISCLAIMER_SHORT}",
        "",
    ]
    for m in items:
        loc = localized_metric(m, lang)
        lines.extend(
            [
                f"### {loc.name}" + (f"（{loc.unit}）" if loc.unit else ""),
                "",
                f"- **{t('what', lang)}**：{loc.what}",
                f"- **{t('why', lang)}**：{loc.why}",
                f"- **{t('ref_range', lang)}**：{loc.healthy}",
            ]
        )
        if loc.notes:
            lines.append(f"- **{t('notes', lang)}**：{loc.notes}")
        lines.append("")
    return "\n".join(lines)
