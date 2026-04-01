"""
K线数据 API 脚本
用法: python3 kline_api.py 000008
输出: JSON 格式的最近60个交易日K线数据
"""

import sys
import os
import json
import akshare as ak
from datetime import datetime, timedelta

# 绕过代理，直连东方财富 API
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("all_proxy", None)
os.environ.pop("ALL_PROXY", None)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No stock code provided"}))
        sys.exit(1)

    code = sys.argv[1]

    # 计算日期范围（多取一些天数以确保有60个交易日）
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=120)).strftime("%Y%m%d")

    try:
        df = ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=start_date,
            end_date=end_date,
            adjust="qfq",  # 前复权
        )
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    if df is None or df.empty:
        print(json.dumps({"error": "No data available", "klines": []}))
        sys.exit(0)

    # 取最近60条
    df = df.tail(60).reset_index(drop=True)

    klines = []
    for _, row in df.iterrows():
        date_str = str(row["日期"])[:10]
        open_p = float(row["开盘"])
        close_p = float(row["收盘"])
        high_p = float(row["最高"])
        low_p = float(row["最低"])
        volume = float(row["成交量"])
        change_pct = float(row["涨跌幅"])

        # 判断是否涨停（涨幅 >= 9.8%，含ST的5%板）
        is_limit_up = change_pct >= 9.8

        klines.append({
            "date": date_str,
            "open": round(open_p, 2),
            "close": round(close_p, 2),
            "high": round(high_p, 2),
            "low": round(low_p, 2),
            "volume": round(volume),
            "changePct": round(change_pct, 2),
            "isLimitUp": is_limit_up,
        })

    print(json.dumps({"klines": klines}))

if __name__ == "__main__":
    main()
