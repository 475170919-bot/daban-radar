"""
backfill_history.py — 回填过去3个月的涨停数据

用 AKShare 逐日获取历史涨停股池，复用 fetch_daily.py 的评分逻辑，
将结果写入 daily_screens 表。支持 upsert，可安全重跑。

运行方式：
  python scripts/backfill_history.py              # 默认回填3个月
  python scripts/backfill_history.py 60            # 回填60天
  python scripts/backfill_history.py 20260101 20260331  # 指定日期范围
"""

import sys
import time
import logging
from datetime import date, timedelta

import akshare as ak

# 复用 fetch_daily 中的所有核心逻辑
from fetch_daily import (
    filter_and_normalize,
    build_row,
    apply_sector_ranking,
    upsert_to_supabase,
    log,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)


def generate_trading_dates(start: date, end: date) -> list[date]:
    """生成日期范围内所有工作日（跳过周末）。"""
    dates = []
    d = start
    while d <= end:
        if d.weekday() < 5:  # 0-4 = 周一到周五
            dates.append(d)
        d += timedelta(days=1)
    return dates


def backfill(start_date: date, end_date: date):
    dates = generate_trading_dates(start_date, end_date)
    log.info(f"===== 开始回填历史数据 =====")
    log.info(f"日期范围：{start_date} ~ {end_date}，共 {len(dates)} 个工作日")

    success_days = 0
    total_rows = 0

    for i, d in enumerate(dates):
        trade_date = d.strftime("%Y%m%d")
        screen_date = d.strftime("%Y-%m-%d")

        log.info(f"[{i+1}/{len(dates)}] 正在处理 {screen_date}...")

        try:
            df = ak.stock_zt_pool_em(date=trade_date)
        except Exception as e:
            log.warning(f"  AKShare 请求失败：{e}")
            time.sleep(3)
            continue

        if df is None or df.empty:
            log.info(f"  无数据（非交易日或节假日），跳过。")
            time.sleep(1)
            continue

        stocks = filter_and_normalize(df)
        if not stocks:
            log.info(f"  过滤后无有效数据，跳过。")
            time.sleep(1)
            continue

        rows = [build_row(s, screen_date) for s in stocks]
        apply_sector_ranking(rows)

        upsert_to_supabase(rows)
        success_days += 1
        total_rows += len(rows)
        log.info(f"  写入 {len(rows)} 条。")

        # 请求间隔2秒，防止被限流
        if i < len(dates) - 1:
            time.sleep(2)

    log.info(f"===== 回填完成 =====")
    log.info(f"成功天数：{success_days}/{len(dates)}，共写入 {total_rows} 条记录。")


def main():
    if len(sys.argv) == 3:
        # 指定起止日期
        s = sys.argv[1]
        e = sys.argv[2]
        start_date = date(int(s[:4]), int(s[4:6]), int(s[6:8]))
        end_date = date(int(e[:4]), int(e[4:6]), int(e[6:8]))
    elif len(sys.argv) == 2:
        # 指定天数
        days = int(sys.argv[1])
        end_date = date.today() - timedelta(days=1)
        start_date = end_date - timedelta(days=days)
    else:
        # 默认3个月（约90天）
        end_date = date.today() - timedelta(days=1)
        start_date = end_date - timedelta(days=90)

    backfill(start_date, end_date)


if __name__ == "__main__":
    main()
