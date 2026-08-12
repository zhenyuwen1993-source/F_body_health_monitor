# Apple 健康本地监控与分析

把 iPhone / Apple Watch（及写入「健康」App 的其他来源）数据导出到本机，做本地入库、指标分析、仪表盘与每日/每周报告。

> **免责声明**：个人健康观察，非医疗诊断。如有不适请咨询专业医生。

## 准备：导出健康数据

1. iPhone 打开 **健康** → 右上角头像 → **导出所有健康数据**
2. 等待导出完成，得到 `导出.zip`（或英文 `export.zip`）
3. 打开仪表盘后 **登录**，在左侧 **上传健康 zip**（无需手动解压）

也可命令行导入到指定用户：

```bash
# 解压后指定用户目录
unzip ~/Downloads/export.zip -d /tmp/health_export
cp /tmp/health_export/apple_health_export/export.xml data/users/<用户名>/export.xml
python scripts/run_pipeline.py --user <用户名>
```

## 安装与运行

```bash
cd health_iwatch
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 打开仪表盘（多用户：注册/登录 + 侧边栏上传 zip）
streamlit run src/web/app.py
```

首次打开请 **注册** 管理员账号（第一位注册用户自动为 admin）。若本机已有旧版 `data/health.db`，注册后会自动迁入该账号目录。

也可只跑流水线：

```bash
python scripts/run_pipeline.py --user admin
python scripts/run_pipeline.py --user alice --skip-ingest
python scripts/run_pipeline.py --export data/sample_export.xml --db data/users/demo/health.db
```

样例数据：

```bash
mkdir -p data/users/demo
cp data/sample_export.xml data/users/demo/export.xml
python scripts/run_pipeline.py --user demo
```

## 多用户说明

| 路径 | 作用 |
|------|------|
| `data/auth.json` | 用户名与密码哈希（勿提交） |
| `data/users/<名>/health.db` | 该用户 SQLite |
| `data/users/<名>/export.xml` | 最近一次导入的导出 |
| `data/users/<名>/reports/` | 该用户报告 |

- 开放自助注册；admin 可在侧边栏创建/禁用用户
- 上传限制见 `.streamlit/config.toml`（默认 200MB）
- **建议仅内网使用**；勿对公网裸奔

## 目录说明

| 路径 | 作用 |
|------|------|
| `data/export.xml` | Apple 健康导出（勿提交 git） |
| `data/health.db` | SQLite 本地库 |
| `data/reports/` | 每日 / 每周 Markdown 报告 |
| `src/ingest/` | 流式解析 XML |
| `src/metrics/` | 日聚合、基线、心情推断 |
| `src/reports/` | 报告生成 |
| `src/web/app.py` | Streamlit 仪表盘 |

## 仪表盘页面

1. **今日总览** — Essentials 四卡（准备度/睡眠/HRV/能量）+ Morning Report + 建议
2. **全部总览 / 月度 / 趋势**
3. **训练** — Workout 心率区间
4. **Agent / 指标词典 / 报告**

## Garmin 风格能力（本地启发式）

- **训练准备度**、**HRV 状态**、**睡眠需求/债**、**恢复时间**
- **Body Battery 近似**、**Strain**、**训练状态**、**今日建议课**
- **习惯日记**（酒精/旅行等）与简单 Impact 观察

## WHOOP 风格铁三角（本地可算部分）

- **Recovery %**：SDNN + 静息心率相对个人基线（Athlytic/Bevel 思路；非 rMSSD）
- **Strain 0–21**：Banister TRIMP × 心率储备 + Apple PhysicalEffort
- **Sleep Performance** + **Target Strain Zone**（restore / maintain / perform）
- 竞品参考：WHOOP、Garmin、Athlytic、Bevel、Oura、HRV4Training、Gentler Streak、TrainingPeaks
- 做不到：实时腕上 Strain、rMSSD 原波、腕温、与 WHOOP 绝对分对齐（详见 `src/metrics/triad.py` 模块注释）

## 心情数据

- 优先使用健康 App「心态」（State of Mind）记录
- 若无记录，根据睡眠、HRV、静息心率、活动量相对个人基线做间接推断
- 仪表盘支持写入手动心情打分（1–5）

## 进阶能力

- **数据窗口**：默认只分析 **2026-01-01 及以后**（可在 `src/config.py` 的 `DATA_START_DATE` 修改）
- **诊断建议**：自动打标未达标指标，并给出运动 / 恢复 / 生活习惯建议
- **中医参考**：根据疲劳、睡眠、活动等做粗体质倾向观察（非面诊、不处方）
- **八字参考**：在 `data/profile.json` 填写生辰后启用（见 `data/profile.example.json`）
- **多源去重**：步数/活动能量等按 Watch > 手动 Health > iPhone 择优，避免双计
- **训练负荷**：每日 Load + CTL/ATL/TSB（Banister 模型）
- **睡眠一致性**：入睡/醒来时间的滚动稳定性（0–100）
- **健康 Agent**：

```bash
python scripts/chat.py "今天恢复怎么样？"
python scripts/chat.py   # 交互模式
# 仪表盘也有 Agent 页；若本机运行 Ollama 会自动用本地模型增强
```

## 更新数据

重新在 iPhone 导出并覆盖 `data/export.xml`，再执行：

```bash
python scripts/run_pipeline.py
```
