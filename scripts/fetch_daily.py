"""
fetch_daily.py — 打板雷达每日数据抓取脚本

功能：
1. 用 AKShare 获取今日涨停股池数据
2. 按评分算法对每只股票打分（0-100分）
3. 通过 httpx 调用 Supabase REST API，将结果写入 daily_screens 表

运行方式：
  python scripts/fetch_daily.py

依赖环境变量（在 .env.local 中配置）：
  SUPABASE_URL=https://xxxxx.supabase.co
  SUPABASE_KEY=your-service-role-key
"""

import os
import sys
import json
import logging
from datetime import date, datetime, timedelta

import httpx
import akshare as ak
import pandas as pd
from dotenv import load_dotenv

# 加载 .env.local 文件中的环境变量
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────

def time_to_minutes(time_str: str) -> int:
    """
    把首封时间转换成距开盘（9:30）的分钟数。
    兼容两种格式：'093512' 和 '09:35:12'
    """
    try:
        time_str = str(time_str).replace(":", "").strip()
        if len(time_str) < 6:
            return 999  # 无效时间，排最后
        hour = int(time_str[0:2])
        minute = int(time_str[2:4])
        total_minutes = hour * 60 + minute
        open_minutes = 9 * 60 + 30  # 9:30 开盘
        return max(0, total_minutes - open_minutes)
    except Exception:
        return 999


def get_score_label(score: float) -> str:
    """根据分数返回中文评级标签"""
    if score >= 85:
        return "强烈关注"
    elif score >= 70:
        return "值得观察"
    elif score >= 50:
        return "一般"
    else:
        return "谨慎"


def generate_warnings(stock: dict) -> list[str]:
    """
    致命缺陷预警标签。根据评分子项和组合条件生成警告列表。

    规则：
    1. 封单比得分 ≤ 12（满分30的40%）→ "封盘极弱"
    2. 首封时间在午后（得分 ≤ 10）→ "午后弱封"
    3. 炸板次数 ≥ 2 → "反复炸板"
    4. 连板 ≥ 4 且封单比 < 5% → "高位弱封风险"
    """
    warnings = []

    # —— 计算各子项得分（与 calculate_score 一致） ——

    # 封单比得分
    seal_amount = stock.get("seal_amount", 0) or 0
    circ_mv = stock.get("circ_mv", 1) or 1
    seal_ratio = seal_amount / circ_mv * 100
    if seal_ratio >= 15:
        seal_score = 30
    elif seal_ratio >= 10:
        seal_score = 25
    elif seal_ratio >= 5:
        seal_score = 18
    elif seal_ratio >= 2:
        seal_score = 10
    else:
        seal_score = 3

    # 首封时间得分
    minutes = time_to_minutes(stock.get("first_seal_time", ""))
    if minutes <= 2:
        time_score = 25
    elif minutes <= 15:
        time_score = 22
    elif minutes <= 60:
        time_score = 16
    elif minutes <= 120:
        time_score = 10
    else:
        time_score = 5

    bc = stock.get("board_count", 1) or 1
    oc = stock.get("open_count", 0) or 0

    # —— 应用规则 ——

    # 1. 封单比得分 ≤ 12（满分30的40%）
    if seal_score <= 12:
        warnings.append("封盘极弱")

    # 2. 首封时间在午后（得分 ≤ 10）
    if time_score <= 10:
        warnings.append("午后弱封")

    # 3. 炸板 ≥ 2 次
    if oc >= 2:
        warnings.append("反复炸板")

    # 4. 连板 ≥ 4 且封单比 < 5%
    if bc >= 4 and seal_ratio < 5:
        warnings.append("高位弱封风险")

    return warnings


def generate_prediction(stock: dict) -> str:
    """
    明日剧本推演——纯规则引擎，根据各维度得分组合生成预判文案。
    规则按优先级从高到低匹配，命中即返回。
    """
    seal_amount = stock.get("seal_amount", 0) or 0
    circ_mv = stock.get("circ_mv", 1) or 1
    seal_ratio = seal_amount / circ_mv * 100
    minutes = time_to_minutes(stock.get("first_seal_time", ""))
    bc = stock.get("board_count", 1) or 1
    oc = stock.get("open_count", 0) or 0

    super_early = minutes <= 5    # 秒板/极早封
    early = minutes <= 15         # 早盘15分钟内
    mid = minutes <= 60           # 上午
    seal_strong = seal_ratio >= 10
    seal_ok = seal_ratio >= 5
    seal_weak = seal_ratio < 3
    seal_very_weak = seal_ratio < 2

    # ── 高危组合（优先匹配） ──

    # 首封极早 + 封单极弱 + 2连板 → 情绪板无资金沉淀
    if super_early and seal_weak and bc == 2:
        return (
            "该股首封极早但买盘承接严重不足，属于典型的情绪板。"
            "明日预期：谨防高开诱多或低开闷杀。"
            "操作建议：持筹者若早盘高开不及预期（低于3%）或冲高无力，建议果断止盈；"
            "空仓者不建议排板接力3板，炸板风险极高。"
        )

    # 高位板（≥4）+ 封单弱 → 高位弱封
    if bc >= 4 and not seal_ok:
        return (
            f"该股已{bc}连板处于高位，但封单比仅{seal_ratio:.1f}%，资金承接力度不足。"
            "明日预期：高位股一旦开板，跌幅往往剧烈。"
            "操作建议：严格设定止损位，若开盘封单快速流失或低于昨日50%，立即离场。"
        )

    # 反复炸板（≥2次）→ 筹码博弈激烈
    if oc >= 2:
        return (
            f"该股炸板{oc}次，说明筹码博弈非常激烈，多空分歧大。"
            "明日预期：冲高回落概率较高。"
            "操作建议：不做无脑接力，尤其对高位板更要等强承接信号再动；"
            "若盘中再次开板且封不回，果断放弃。"
        )

    # 封单极弱 + 多板 → 先天短板
    if seal_very_weak and bc >= 2:
        return (
            "封单比极低属于'先天短板'，主力封板意愿不强。"
            "明日预期：更容易在开盘后出现回落或反复换手。"
            "操作建议：只看回封质量，不追高；若盘中开板或封单快速流失，优先兑现。"
        )

    # 午后弱封 + 多板 → 尾盘拉升可疑
    if not mid and bc >= 2:
        return (
            "首封时间偏晚（午后封板），市场拉升的主线支撑可能不足。"
            "明日预期：高开时更像情绪宣泄而非真正加速。"
            "操作建议：宁可等分歧确认（观察第一个小时走势），也尽量避免开盘追涨。"
        )

    # ── 中性组合 ──

    # 首封早 + 封单一般 + 首板
    if early and not seal_strong and bc == 1:
        return (
            "首板股首封时间较早，但封单比一般，属于中等质量涨停。"
            "明日预期：若板块持续发酵可能有溢价，否则大概率震荡。"
            "操作建议：关注次日竞价情况，若高开3%-5%可观望是否能二封；"
            "若低开则回避。"
        )

    # 首封早 + 封单强 + 2连板 → 晋级3板潜力
    if early and seal_strong and bc == 2:
        return (
            "封板质量较高：首封时间早且封单充足，2连板有一定人气基础。"
            "明日预期：存在晋级3板的可能性，关注能否放量突破。"
            "操作建议：若竞价高开5%以上且量能配合，可考虑参与；"
            "若高开后快速回落破均线，及时止损。"
        )

    # 首封早 + 封单强 + 3连板 → 情绪核心
    if early and seal_strong and bc == 3:
        return (
            f"3连板且封单比{seal_ratio:.1f}%表现强势，有望成为短线情绪核心。"
            "明日预期：市场关注度高，但4板位置也是分歧加大的关口。"
            "操作建议：可跟踪但仓位宜轻，注意观察竞价量能和板块跟随度；"
            "若开盘即炸板则快速止损。"
        )

    # 首封早 + 封单强 + 首板 → 优质首板
    if early and seal_strong and bc == 1:
        return (
            f"优质首板信号：首封时间早（开盘{minutes}分钟内），封单比{seal_ratio:.1f}%较高。"
            "明日预期：有较高的次日溢价概率。"
            "操作建议：关注次日竞价强度，若高开且封单维持可考虑持有；"
            "重点观察板块是否有联动效应。"
        )

    # 午后首板 + 封单强
    if not mid and seal_strong and bc == 1:
        return (
            "虽然首封时间偏晚（午后封板），但封单比较高显示资金承接力度足。"
            "明日预期：有一定溢价空间但不宜期望过高。"
            "操作建议：适合轻仓参与，重点看次日开盘量价是否配合。"
        )

    # ── 默认模板 ──
    return (
        "整体属于可跟踪的涨停股，用'封单变化 + 开板次数'做风控锚点。"
        "明日预期：偏向高波动，但只要封单能维持且不反复开板，就存在延续机会；"
        "反之及时止损。"
    )


# ──────────────────────────────────────────────
# 评分算法（来自 SKILL.md）
# ──────────────────────────────────────────────

def calculate_score(stock: dict) -> float:
    """
    对单只涨停股打分，满分 100 分，分越高质量越强。

    权重分配：
    - 封单比     30%
    - 首封时间   25%
    - 连板数     20%
    - 炸板次数   15%
    - 板块效应   10%
    """
    score = 0.0

    # 1. 封单比（封板资金 / 流通市值 * 100）— 30%
    seal_amount = stock.get("seal_amount", 0) or 0
    circ_mv = stock.get("circ_mv", 1) or 1  # 防止除以零
    seal_ratio = seal_amount / circ_mv * 100
    if seal_ratio >= 15:
        score += 30
    elif seal_ratio >= 10:
        score += 25
    elif seal_ratio >= 5:
        score += 18
    elif seal_ratio >= 2:
        score += 10
    else:
        score += 3

    # 2. 首封时间 — 25%
    minutes = time_to_minutes(stock.get("first_seal_time", ""))
    if minutes <= 2:       # 秒板
        score += 25
    elif minutes <= 15:    # 早盘15分钟内
        score += 22
    elif minutes <= 60:    # 10:30前
        score += 16
    elif minutes <= 120:   # 11:30前
        score += 10
    else:                  # 午后
        score += 5

    # 3. 连板数 — 20%
    bc = stock.get("board_count", 1) or 1
    if bc == 1:
        score += 8
    elif bc == 2:
        score += 16
    elif bc == 3:
        score += 20
    else:  # 4板及以上，高位风险加大
        score += 14

    # 4. 炸板次数 — 15%
    oc = stock.get("open_count", 0) or 0
    if oc == 0:
        score += 15
    elif oc == 1:
        score += 8
    elif oc == 2:
        score += 3
    else:
        score += 0

    # 5. 板块效应（同行业涨停数）— 10%
    sector_count = stock.get("sector_limit_count", 0) or 0
    if sector_count >= 5:
        score += 10
    elif sector_count >= 3:
        score += 7
    elif sector_count >= 1:
        score += 4
    else:
        score += 1

    return round(score, 1)


# ──────────────────────────────────────────────
# 数据抓取
# ──────────────────────────────────────────────

def fetch_zt_data(trade_date: str) -> pd.DataFrame:
    """
    用 AKShare 获取指定日期的涨停股池。
    trade_date 格式：'20260330'
    """
    log.info(f"正在从 AKShare 获取 {trade_date} 涨停数据...")
    df = ak.stock_zt_pool_em(date=trade_date)

    if df is None or df.empty:
        log.warning("涨停股池为空，可能今天是非交易日或数据尚未更新。")
        return pd.DataFrame()

    log.info(f"共获取到 {len(df)} 只涨停股。")
    return df


def filter_and_normalize(df: pd.DataFrame) -> list[dict]:
    """
    清洗数据：
    - 过滤 ST 股票
    - 过滤封板资金为 0 的股票（数据不完整）
    - 重命名字段为英文
    - 计算板块效应（同行业涨停数）
    """
    # 重命名列
    rename_map = {
        "代码": "code",
        "名称": "name",
        "涨停价": "limit_price",
        "最新价": "current_price",
        "成交额": "turnover_amount",
        "流通市值": "circ_mv",
        "总市值": "total_mv",
        "换手率": "turnover_rate",
        "封板资金": "seal_amount",
        "首次封板时间": "first_seal_time",
        "最后封板时间": "last_seal_time",
        "炸板次数": "open_count",
        "涨停统计": "zt_stats",
        "连板数": "board_count",
        "所属行业": "industry",
    }
    df = df.rename(columns=rename_map)

    # 只保留有映射的列（防止列名变化报错）
    available = [c for c in rename_map.values() if c in df.columns]
    df = df[available].copy()

    # 过滤 ST 股票
    before = len(df)
    df = df[~df["name"].str.contains("ST", case=False, na=False)]
    log.info(f"过滤 ST 股票：{before - len(df)} 只，剩余 {len(df)} 只。")

    # 过滤封板资金为 0 的股票
    before = len(df)
    df = df[df["seal_amount"].fillna(0) > 0]
    log.info(f"过滤封板资金为0的股票：{before - len(df)} 只，剩余 {len(df)} 只。")

    if df.empty:
        return []

    # 计算板块效应：同行业有多少只股票也涨停
    industry_counts = df["industry"].value_counts().to_dict()
    df["sector_limit_count"] = df["industry"].map(industry_counts) - 1  # 减去自身

    # 转换为 dict 列表
    records = df.to_dict(orient="records")
    return records


# ──────────────────────────────────────────────
# 写入 Supabase
# ──────────────────────────────────────────────

def build_row(stock: dict, screen_date: str) -> dict:
    """把单只股票数据整理成 daily_screens 表的一行。"""
    seal_amount = stock.get("seal_amount", 0) or 0
    circ_mv = stock.get("circ_mv", 1) or 1
    seal_ratio = round(seal_amount / circ_mv * 100, 2)

    score = calculate_score(stock)
    label = get_score_label(score)
    warnings = generate_warnings(stock)
    prediction = generate_prediction(stock)

    # 把首封时间统一转成 HH:MM:SS 格式存储
    raw_time = str(stock.get("first_seal_time", "") or "")
    raw_time = raw_time.replace(":", "").strip()
    if len(raw_time) >= 6:
        formatted_time = f"{raw_time[0:2]}:{raw_time[2:4]}:{raw_time[4:6]}"
    else:
        formatted_time = raw_time

    return {
        "screen_date": screen_date,
        "code": str(stock.get("code", "")),
        "name": str(stock.get("name", "")),
        "limit_price": float(stock.get("limit_price") or 0),
        "seal_amount": float(seal_amount),
        "seal_ratio": seal_ratio,
        "first_seal_time": formatted_time,
        "turnover_rate": float(stock.get("turnover_rate") or 0),
        "circ_mv": float(circ_mv),
        "board_count": int(stock.get("board_count") or 1),
        "open_count": int(stock.get("open_count") or 0),
        "concept": str(stock.get("industry", "") or ""),
        "score": score,
        "score_label": label,
        "warnings": warnings,
        "prediction": prediction,
    }


def upsert_to_supabase(rows: list[dict]) -> None:
    """
    通过 httpx 调用 Supabase REST API，批量 upsert 数据。
    遇到 screen_date + code 重复时覆盖写入。
    """
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    supabase_key = os.environ.get("SUPABASE_KEY", "")

    if not supabase_url or not supabase_key:
        log.error("缺少 SUPABASE_URL 或 SUPABASE_KEY 环境变量，请检查 .env.local 文件。")
        sys.exit(1)

    endpoint = f"{supabase_url}/rest/v1/daily_screens?on_conflict=screen_date,code"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        # merge-duplicates = UPSERT，遇到唯一键冲突时更新而非报错
        "Prefer": "resolution=merge-duplicates",
    }

    # 分批写入，每批 50 条，避免请求体过大
    batch_size = 50
    total = len(rows)
    success = 0

    for i in range(0, total, batch_size):
        batch = rows[i : i + batch_size]
        try:
            response = httpx.post(
                endpoint,
                headers=headers,
                content=json.dumps(batch, ensure_ascii=False),
                timeout=30,
            )
            if response.status_code in (200, 201):
                success += len(batch)
                log.info(f"已写入 {min(i + batch_size, total)}/{total} 条。")
            else:
                log.error(
                    f"写入第 {i//batch_size + 1} 批失败：HTTP {response.status_code}\n{response.text}"
                )
        except httpx.RequestError as e:
            log.error(f"网络请求失败：{e}")

    log.info(f"Supabase 写入完成：{success}/{total} 条成功。")


# ──────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────

def main():
    # 默认抓今天的数据；若市场收盘前运行可手动传日期参数
    if len(sys.argv) > 1:
        trade_date = sys.argv[1]  # 例如 python fetch_daily.py 20260330
    else:
        trade_date = date.today().strftime("%Y%m%d")

    screen_date = f"{trade_date[0:4]}-{trade_date[4:6]}-{trade_date[6:8]}"
    log.info(f"===== 打板雷达 · 日期：{screen_date} =====")

    # 1. 抓取涨停数据
    df = fetch_zt_data(trade_date)
    if df.empty:
        log.info("没有数据，脚本退出。")
        return

    # 2. 清洗 & 计算板块效应
    stocks = filter_and_normalize(df)
    if not stocks:
        log.info("过滤后没有有效数据，脚本退出。")
        return

    # 3. 打分 & 整理成数据库行
    rows = [build_row(s, screen_date) for s in stocks]

    # 4. 板块内PK排名（按首封时间升序 + 封单比降序综合排名）
    by_sector = {}
    for row in rows:
        sector = row.get("concept", "")
        if sector:
            by_sector.setdefault(sector, []).append(row)

    for sector, group in by_sector.items():
        # 排名规则：首封时间越早越好，同时间则封单比越高越好
        group.sort(key=lambda r: (
            time_to_minutes(r.get("first_seal_time", "")),
            -(r.get("seal_ratio", 0) or 0),
        ))
        total = len(group)
        for rank, row in enumerate(group, 1):
            row["sector_rank"] = rank
            row["sector_total"] = total

    # 没有行业的股票也要填默认值
    for row in rows:
        row.setdefault("sector_rank", 1)
        row.setdefault("sector_total", 1)

    # 按分数降序排列（方便查看日志）
    rows.sort(key=lambda r: r["score"], reverse=True)

    log.info(f"评分完成，共 {len(rows)} 只股票。")
    log.info(f"  强烈关注（≥85分）：{sum(1 for r in rows if r['score'] >= 85)} 只")
    log.info(f"  值得观察（70-84）：{sum(1 for r in rows if 70 <= r['score'] < 85)} 只")
    log.info(f"  一般    （50-69）：{sum(1 for r in rows if 50 <= r['score'] < 70)} 只")
    log.info(f"  谨慎    （<50）  ：{sum(1 for r in rows if r['score'] < 50)} 只")
    warned = sum(1 for r in rows if r.get("warnings"))
    log.info(f"  致命缺陷预警：{warned} 只")

    # 打印前5名
    log.info("--- 今日 TOP 5 ---")
    for r in rows[:5]:
        log.info(
            f"  {r['name']}({r['code']})  {r['score']}分 [{r['score_label']}]"
            f"  连板:{r['board_count']}  封单比:{r['seal_ratio']}%"
            f"  首封:{r['first_seal_time']}"
        )

    # 4. 写入 Supabase
    upsert_to_supabase(rows)
    log.info("===== 全部完成 =====")


if __name__ == "__main__":
    main()
