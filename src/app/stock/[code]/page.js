import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import KlineChart from "./KlineChart";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// 获取该股票最新一条选股记录（用于显示头部信息）
async function getStockInfo(code) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("daily_screens")
    .select("*")
    .eq("code", code)
    .order("screen_date", { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

// 获取该股票所有涨停记录
async function getLimitUpHistory(code) {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("daily_screens")
    .select("screen_date,score,score_label,board_count,seal_ratio,first_seal_time,open_count,warnings,prediction")
    .eq("code", code)
    .order("screen_date", { ascending: false })
    .limit(20);

  if (error) return [];
  return data || [];
}

function getScoreStyle(score) {
  if (score >= 85) return { text: "text-emerald-600", bg: "bg-emerald-50", hex: "#059669" };
  if (score >= 70) return { text: "text-amber-600",   bg: "bg-amber-50",   hex: "#d97706" };
  if (score >= 50) return { text: "text-gray-500",    bg: "bg-gray-100",   hex: "#6b7280" };
  return               { text: "text-red-500",     bg: "bg-red-50",     hex: "#ef4444" };
}

function ScoreRing({ score }) {
  const r = 24;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const { hex } = getScoreStyle(score);

  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle
        cx="28" cy="28" r={r}
        fill="none"
        stroke={hex}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 28 28)"
      />
      <text
        x="28" y="33"
        textAnchor="middle"
        fill={hex}
        fontSize="15"
        fontWeight="700"
        fontFamily="ui-monospace, 'SF Mono', monospace"
      >
        {score}
      </text>
    </svg>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(m)}月${parseInt(d)}日`;
}

export default async function StockDetailPage({ params }) {
  const { code } = await params;
  const [stock, history] = await Promise.all([
    getStockInfo(code),
    getLimitUpHistory(code),
  ]);

  if (!stock) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-lg mb-4">未找到股票 {code} 的数据</p>
          <Link href="/" className="text-blue-500 hover:text-blue-600 text-sm">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const { text: scoreText, bg: scoreBg } = getScoreStyle(stock.score);
  const warnings = (stock.warnings || []).map((w) =>
    typeof w === "string" ? w.replace(/^⚠️?\s*/, "") : w
  );

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* 顶部导航 */}
      <header className="border-b border-gray-200 px-4 py-3 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="max-w-[720px] mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">
            &larr; 返回
          </Link>
          <span className="text-gray-300">|</span>
          <span className="text-gray-900 font-semibold">{stock.name}</span>
          <span className="text-gray-400 font-mono text-sm">{code}</span>
        </div>
      </header>

      <main className="max-w-[720px] mx-auto px-4 py-6">
        {/* ── 头部信息卡 ── */}
        <div className="bg-[#f8f9fa] border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-4">
            <ScoreRing score={stock.score} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-900 font-bold text-lg">{stock.name}</span>
                <span className="text-gray-400 font-mono text-sm">{code}</span>
                {stock.concept && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">{stock.concept}</span>
                )}
                {stock.board_count > 1 && (
                  <span className="px-1.5 py-0.5 bg-red-50 text-red-500 text-xs rounded font-medium">
                    {stock.board_count}连板
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${scoreText} ${scoreBg}`}>
                  {stock.score_label}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                <span>封单比 <span className="font-mono text-gray-700">{stock.seal_ratio?.toFixed(1)}%</span></span>
                <span className="text-gray-300">·</span>
                <span>首封 <span className="font-mono text-gray-700">{stock.first_seal_time?.slice(0, 5) || "-"}</span></span>
                <span className="text-gray-300">·</span>
                <span>炸板 <span className="font-mono text-gray-700">{stock.open_count || 0}次</span></span>
                {stock.sector_total > 1 && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span>{stock.concept}板块{stock.sector_total}只 排名#{stock.sector_rank}</span>
                  </>
                )}
              </div>
              {warnings.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  {warnings.map((w) => (
                    <span key={w} className="px-2 py-0.5 rounded bg-red-500 text-white text-[11px] font-semibold">
                      {w}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── K线图 ── */}
        <div className="bg-[#f8f9fa] border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-gray-800 font-semibold text-sm">K线走势</h2>
            <span className="text-gray-400 text-xs">最近60个交易日 · 前复权</span>
          </div>
          <KlineChart code={code} />
          <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400 justify-end">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> 涨 / 涨停
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" /> 跌
            </span>
          </div>
        </div>

        {/* ── 涨停历史记录 ── */}
        <div className="bg-[#f8f9fa] border border-gray-200 rounded-xl p-4">
          <h2 className="text-gray-800 font-semibold text-sm mb-3">
            涨停记录
            <span className="text-gray-400 text-xs font-normal ml-2">共 {history.length} 次</span>
          </h2>

          {history.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">暂无涨停记录</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => {
                const { text: ht, bg: hb } = getScoreStyle(h.score);
                const hw = (h.warnings || []).map((w) =>
                  typeof w === "string" ? w.replace(/^⚠️?\s*/, "") : w
                );
                return (
                  <div
                    key={h.screen_date}
                    className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-100 rounded-lg text-xs"
                  >
                    <span className="text-gray-500 font-mono w-16 shrink-0">{formatDate(h.screen_date)}</span>
                    <span className={`px-1.5 py-0.5 rounded font-medium ${ht} ${hb} shrink-0`}>
                      {h.score}分
                    </span>
                    <span className={`px-1.5 py-0.5 rounded ${ht} ${hb} shrink-0`}>
                      {h.score_label}
                    </span>
                    {h.board_count > 1 && (
                      <span className="text-red-500">{h.board_count}连板</span>
                    )}
                    <span className="text-gray-400">
                      封单{h.seal_ratio?.toFixed(1)}%
                    </span>
                    <span className="text-gray-400">
                      首封{h.first_seal_time?.slice(0, 5) || "-"}
                    </span>
                    {h.open_count > 0 && (
                      <span className="text-orange-500">炸{h.open_count}次</span>
                    )}
                    {hw.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-semibold">
                        {hw[0]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
