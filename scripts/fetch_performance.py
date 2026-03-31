"""
fetch_performance.py — 次日表现追踪脚本

功能：
1. 从 Supabase 读取昨日（或指定日期）的选股结果
2. 用 AKShare 获取这些股票今日的开盘价和收盘价
3. 计算隔日收益率（开盘收益率、收盘收益率）
4. 将结果写入 daily_performance 表

运行方式：
  python scripts/fetch_performance.py              # 追踪上一个交易日的选股
  python scripts/fetch_performance.py 20260327     # 追踪指定日期的选股

依赖环境变量：
  SUPABASE_URL=https://xxxxx.supabase.co
  SUPABASE_KEY=your-service-role-key
"""

import os
import sys
import json
import logging
from datetime import date, datetime, timedelta

import time

import httpx
import akshare as ak
import pandas as pd
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Supabase 工具函数
# ──────────────────────────────────────────────

def get_supabase_config():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        log.error("缺少 SUPABASE_URL 或 SUPABASE_KEY 环境变量。")
        sys.exit(1)
    return url, key


def supabase_headers(key: str) -> dict:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def fetch_screened_stocks(screen_date: str) -> list[dict]:
    """从 daily_screens 表读取指定日期的选股结果。"""
    url, key = get_supabase_config()
    endpoint = f"{url}/rest/v1/daily_screens"
    params = {
        "screen_date": f"eq.{screen_date}",
        "select": "code,name,limit_price,score,score_label",
    }

    resp = httpx.get(endpoint, headers=supabase_headers(key), params=params, timeout=30)
    if resp.status_code != 200:
        log.error(f"读取选股数据失败：HTTP {resp.status_code}\n{resp.text}")
        return []

    data = resp.json()
    log.info(f"从 daily_screens 读取到 {len(data)} 只股票（{screen_date}）。")
    return data


# ──────────────────────────────────────────────
# 获取次日行情
# ──────────────────────────────────────────────

def get_next_day_prices(codes: list[str], track_date: str) -> dict:
    """
    用 AKShare 获取指定日期所有 A 股行情数据，返回字典 {code: {open, close, high, low}}。
    track_date 格式：'20260330'
    """
    log.info(f"正在获取 {track_date} 的行情数据...")

    prices = {}
    failed = []
    max_retries = 3

    for i, code in enumerate(codes):
        success = False
        for attempt in range(max_retries):
            try:
                df = ak.stock_zh_a_hist(
                    symbol=code,
                    period="daily",
                    start_date=track_date,
                    end_date=track_date,
                    adjust="qfq",
                )
                if df is not None and not df.empty:
                    row = df.iloc[0]
                    prices[code] = {
                        "open": float(row["开盘"]),
                        "close": float(row["收盘"]),
                        "high": float(row["最高"]),
                        "low": float(row["最低"]),
                    }
                success = True
                break
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = (attempt + 1) * 2
                    log.warning(f"获取 {code} 失败（第{attempt+1}次），{wait}秒后重试...")
                    time.sleep(wait)
                else:
                    log.warning(f"获取 {code} 行情失败（已重试{max_retries}次）：{e}")
                    failed.append(code)

        # 每个请求间隔 0.5 秒，避免被限流
        if i < len(codes) - 1:
            time.sleep(0.5)

    log.info(f"成功获取 {len(prices)} 只股票行情，失败 {len(failed)} 只。")
    if failed:
        log.warning(f"失败的股票：{', '.join(failed[:10])}")
    return prices


# ──────────────────────────────────────────────
# 计算收益率 & 写入
# ──────────────────────────────────────────────

def calculate_returns(stocks: list[dict], prices: dict, screen_date: str, track_date_fmt: str) -> list[dict]:
    """计算每只股票的隔日收益率。"""
    rows = []
    for stock in stocks:
        code = stock["code"]
        if code not in prices:
            continue

        p = prices[code]
        limit_price = stock.get("limit_price") or 0
        if limit_price <= 0:
            continue

        open_ret = round((p["open"] - limit_price) / limit_price * 100, 2)
        close_ret = round((p["close"] - limit_price) / limit_price * 100, 2)

        rows.append({
            "screen_date": screen_date,
            "code": code,
            "name": stock.get("name", ""),
            "score": stock.get("score"),
            "score_label": stock.get("score_label", ""),
            "limit_price": limit_price,
            "next_open": p["open"],
            "next_close": p["close"],
            "next_high": p["high"],
            "next_low": p["low"],
            "open_return": open_ret,
            "close_return": close_ret,
            "is_win": close_ret > 0,
            "track_date": track_date_fmt,
        })

    return rows


def upsert_performance(rows: list[dict]) -> None:
    """写入 daily_performance 表。"""
    if not rows:
        log.info("没有可写入的追踪数据。")
        return

    url, key = get_supabase_config()
    endpoint = f"{url}/rest/v1/daily_performance"
    headers = supabase_headers(key)
    headers["Prefer"] = "resolution=merge-duplicates"

    batch_size = 50
    total = len(rows)
    success = 0

    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        try:
            resp = httpx.post(
                endpoint,
                headers=headers,
                content=json.dumps(batch, ensure_ascii=False),
                timeout=30,
            )
            if resp.status_code in (200, 201):
                success += len(batch)
                log.info(f"已写入 {min(i + batch_size, total)}/{total} 条。")
            else:
                log.error(f"写入失败：HTTP {resp.status_code}\n{resp.text}")
        except httpx.RequestError as e:
            log.error(f"网络请求失败：{e}")

    log.info(f"追踪数据写入完成：{success}/{total} 条成功。")


# ──────────────────────────────────────────────
# 获取上一个交易日
# ──────────────────────────────────────────────

def get_previous_trading_day(today: date) -> date:
    """
    简单逻辑：往回找最近的工作日（跳过周末）。
    不处理节假日，但够用了——如果那天没数据，脚本会正常退出。
    """
    prev = today - timedelta(days=1)
    while prev.weekday() >= 5:  # 5=周六, 6=周日
        prev -= timedelta(days=1)
    return prev


# ──────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────

def main():
    # 确定追踪哪一天的选股
    if len(sys.argv) > 1:
        # 手动指定选股日期
        screen_date_str = sys.argv[1]  # e.g. "20260327"
        screen_date = f"{screen_date_str[0:4]}-{screen_date_str[4:6]}-{screen_date_str[6:8]}"
        # track_date 为 screen_date 的下一个交易日
        sd = date(int(screen_date_str[0:4]), int(screen_date_str[4:6]), int(screen_date_str[6:8]))
        td = sd + timedelta(days=1)
        while td.weekday() >= 5:
            td += timedelta(days=1)
        track_date = td.strftime("%Y%m%d")
        track_date_fmt = td.strftime("%Y-%m-%d")
    else:
        # 默认：追踪昨天的选股（今天的行情）
        today = date.today()
        prev = get_previous_trading_day(today)
        screen_date = prev.strftime("%Y-%m-%d")
        track_date = today.strftime("%Y%m%d")
        track_date_fmt = today.strftime("%Y-%m-%d")

    log.info(f"===== 次日表现追踪 =====")
    log.info(f"选股日期：{screen_date}")
    log.info(f"追踪日期：{track_date_fmt}")

    # 1. 读取选股结果
    stocks = fetch_screened_stocks(screen_date)
    if not stocks:
        log.info("该日期没有选股数据，脚本退出。")
        return

    codes = [s["code"] for s in stocks]

    # 2. 获取次日行情
    prices = get_next_day_prices(codes, track_date)
    if not prices:
        log.info("无法获取行情数据（可能是非交易日），脚本退出。")
        return

    # 3. 计算收益率
    rows = calculate_returns(stocks, prices, screen_date, track_date_fmt)

    if not rows:
        log.info("没有有效的收益率数据，脚本退出。")
        return

    # 打印统计
    wins = sum(1 for r in rows if r["is_win"])
    avg_ret = sum(r["close_return"] for r in rows) / len(rows)
    log.info(f"共 {len(rows)} 只追踪成功")
    log.info(f"命中率：{wins}/{len(rows)} = {wins/len(rows)*100:.1f}%")
    log.info(f"平均收盘收益率：{avg_ret:.2f}%")

    # TOP/BOTTOM 3
    sorted_rows = sorted(rows, key=lambda r: r["close_return"], reverse=True)
    log.info("--- 收益最高 ---")
    for r in sorted_rows[:3]:
        log.info(f"  {r['name']}({r['code']}) 评分{r['score']} → 收益{r['close_return']:+.2f}%")
    log.info("--- 收益最低 ---")
    for r in sorted_rows[-3:]:
        log.info(f"  {r['name']}({r['code']}) 评分{r['score']} → 收益{r['close_return']:+.2f}%")

    # 4. 写入 Supabase
    upsert_performance(rows)
    log.info("===== 追踪完成 =====")


if __name__ == "__main__":
    main()
