import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { code } = await params;

  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid stock code" }, { status: 400 });
  }

  // 确定市场前缀：6开头是上海(1.)，其他是深圳(0.)
  const market = code.startsWith("6") ? "1" : "0";
  const secid = `${market}.${code}`;

  const end = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");

  const apiUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=${start}&end=${end}&lmt=60`;

  // 方法1：直接 fetch 东方财富 API（Vercel 上可用）
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://quote.eastmoney.com/",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok) {
      const json = await resp.json();
      const klines = parseEastmoneyKlines(json);
      if (klines.length > 0) {
        return NextResponse.json({ klines });
      }
    }
  } catch (e) {
    console.log("Direct fetch failed, trying Python fallback:", e.message);
  }

  // 方法2：回退到 Python AKShare（本地开发可用）
  try {
    const { execSync } = await import("child_process");
    const { join } = await import("path");
    const scriptPath = join(process.cwd(), "scripts", "kline_api.py");
    const result = execSync(`python3 "${scriptPath}" ${code} 2>/dev/null`, {
      timeout: 30000,
      encoding: "utf-8",
    });
    const data = JSON.parse(result.trim());
    if (data.klines && data.klines.length > 0) {
      return NextResponse.json(data);
    }
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 502 });
    }
  } catch (e) {
    console.log("Python fallback also failed:", e.message);
  }

  return NextResponse.json(
    { error: "当前网络无法访问行情数据，请稍后重试（部署到 Vercel 后可正常使用）" },
    { status: 502 }
  );
}

function parseEastmoneyKlines(json) {
  return (json.data?.klines || []).map((line) => {
    // 格式: "2026-03-28,3.23,3.38,3.38,3.23,1234567,金额,涨跌幅,涨跌额,振幅,换手率"
    const parts = line.split(",");
    const date = parts[0];
    const open = parseFloat(parts[1]);
    const close = parseFloat(parts[2]);
    const high = parseFloat(parts[3]);
    const low = parseFloat(parts[4]);
    const volume = parseFloat(parts[5]);
    const changePct = parseFloat(parts[8]);
    return {
      date,
      open,
      close,
      high,
      low,
      volume,
      changePct,
      isLimitUp: changePct >= 9.8,
    };
  });
}
