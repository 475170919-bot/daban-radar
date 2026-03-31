import { createClient } from "@supabase/supabase-js";
import StockList from "./StockList";
import { patternKey } from "./utils/patternUtils";

// 每5分钟重新验证一次缓存（数据每天只更新一次，5分钟足够）
export const revalidate = 300;
// 避免 Next 在构建阶段就预渲染页面导致环境变量缺失时报错
export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  return createClient(
    url,
    key
  );
}

async function getScreenData() {
  const supabase = getSupabase();
  if (!supabase) return { stocks: [], screenDate: null };

  // 第一步：找出数据库里最新的筛选日期
  const { data: dateRow, error: dateErr } = await supabase
    .from("daily_screens")
    .select("screen_date")
    .order("screen_date", { ascending: false })
    .limit(1)
    .single();

  if (dateErr || !dateRow) return { stocks: [], screenDate: null };

  // 第二步：取该日期的全部股票数据，按评分从高到低排列
  const { data: stocks, error: stockErr } = await supabase
    .from("daily_screens")
    .select("*")
    .eq("screen_date", dateRow.screen_date)
    .order("score", { ascending: false });

  if (stockErr) {
    console.error("Supabase fetch error:", stockErr.message);
    return { stocks: [], screenDate: dateRow.screen_date };
  }

  return { stocks: stocks ?? [], screenDate: dateRow.screen_date };
}

async function getPerformanceStats() {
  const supabase = getSupabase();
  if (!supabase) return null;

  // 读取所有追踪数据
  const { data, error } = await supabase
    .from("daily_performance")
    .select("score,score_label,close_return,open_return,is_win,screen_date");

  if (error || !data || data.length === 0) return null;

  // 总体统计
  const total = data.length;
  const wins = data.filter((d) => d.is_win).length;
  const avgReturn = data.reduce((s, d) => s + (d.close_return || 0), 0) / total;
  const avgOpenReturn = data.reduce((s, d) => s + (d.open_return || 0), 0) / total;

  // 按评级分组统计
  const byLabel = {};
  for (const d of data) {
    const label = d.score_label || "未知";
    if (!byLabel[label]) byLabel[label] = { total: 0, wins: 0, returns: [] };
    byLabel[label].total++;
    if (d.is_win) byLabel[label].wins++;
    byLabel[label].returns.push(d.close_return || 0);
  }

  const labelStats = Object.entries(byLabel).map(([label, stat]) => ({
    label,
    total: stat.total,
    winRate: stat.total > 0 ? (stat.wins / stat.total * 100) : 0,
    avgReturn: stat.returns.length > 0
      ? stat.returns.reduce((a, b) => a + b, 0) / stat.returns.length
      : 0,
  }));

  // 按命中率排序
  labelStats.sort((a, b) => b.winRate - a.winRate);

  // 追踪天数
  const uniqueDates = new Set(data.map((d) => d.screen_date));

  return {
    total,
    wins,
    winRate: (wins / total * 100),
    avgReturn,
    avgOpenReturn,
    trackDays: uniqueDates.size,
    labelStats,
  };
}

// ─────────────────────────────────────────────
// 历史相似形态回测（按 patternKey 分档聚合）
// 拉取过去3个月的 daily_screens + daily_performance，按 patternKey 分组统计
// 返回 Map<patternKey, { sampleCount, winRate, avgCloseReturn, avgOpenReturn }>
// ─────────────────────────────────────────────
async function getPerStockBacktestStats() {
  const supabase = getSupabase();
  if (!supabase) return null;

  // 以最新的 screen_date 作为 endDate
  const { data: latestRow, error: latestErr } = await supabase
    .from("daily_screens")
    .select("screen_date")
    .order("screen_date", { ascending: false })
    .limit(1)
    .single();

  if (latestErr || !latestRow?.screen_date) return null;

  const endDate = new Date(latestRow.screen_date + "T00:00:00");
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 3);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  // 1) 拉取过去3个月的所有 daily_screens（需要 board_count, first_seal_time, seal_ratio 来算 patternKey）
  let allScreens = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("daily_screens")
      .select("screen_date,code,board_count,first_seal_time,seal_ratio")
      .gte("screen_date", startStr)
      .lte("screen_date", endStr)
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("Backtest fetch screens error:", error.message);
      return null;
    }
    if (!data || data.length === 0) break;
    allScreens = allScreens.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  if (allScreens.length === 0) return {};

  // 2) 拉取过去3个月的所有 daily_performance
  let allPerfs = [];
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("daily_performance")
      .select("screen_date,code,close_return,open_return,is_win")
      .gte("screen_date", startStr)
      .lte("screen_date", endStr)
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("Backtest fetch performance error:", error.message);
      return null;
    }
    if (!data || data.length === 0) break;
    allPerfs = allPerfs.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  // 3) 建立 performance 查找表：screen_date|code -> perf
  const perfByKey = new Map(allPerfs.map((p) => [`${p.screen_date}|${p.code}`, p]));

  // 4) 按 patternKey 分组聚合
  const buckets = {};
  for (const s of allScreens) {
    const pk = patternKey(s.board_count || 1, s.first_seal_time || "", s.seal_ratio || 0);
    const perf = perfByKey.get(`${s.screen_date}|${s.code}`);
    if (!perf) continue; // 没有次日表现数据，跳过

    if (!buckets[pk]) {
      buckets[pk] = { total: 0, wins: 0, closeReturns: [], openReturns: [] };
    }
    const b = buckets[pk];
    b.total++;
    if (perf.is_win) b.wins++;
    b.closeReturns.push(perf.close_return || 0);
    b.openReturns.push(perf.open_return || 0);
  }

  // 5) 转成最终 map
  const result = {};
  for (const [pk, b] of Object.entries(buckets)) {
    result[pk] = {
      sampleCount: b.total,
      winRate: b.total > 0 ? (b.wins / b.total) * 100 : 0,
      avgCloseReturn: b.closeReturns.length > 0
        ? b.closeReturns.reduce((a, c) => a + c, 0) / b.closeReturns.length
        : 0,
      avgOpenReturn: b.openReturns.length > 0
        ? b.openReturns.reduce((a, c) => a + c, 0) / b.openReturns.length
        : 0,
    };
  }

  return result;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  // dateStr 格式：'2026-03-27'，直接解析避免时区问题
  const [y, m, d] = dateStr.split("-");
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}

// 判断日期是否是今天
function isToday(dateStr) {
  if (!dateStr) return false;
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
  return dateStr === today;
}

// ── 评级标签颜色 ──
const labelColor = {
  "强烈关注": { text: "text-emerald-400", bg: "bg-emerald-400/15" },
  "值得观察": { text: "text-amber-400",   bg: "bg-amber-400/15" },
  "一般":     { text: "text-slate-400",   bg: "bg-slate-400/15" },
  "谨慎":     { text: "text-red-400",     bg: "bg-red-400/15" },
};

function HitRateCard({ stats }) {
  return (
    <div className="mb-6 bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">📈</span>
        <h2 className="text-slate-100 font-semibold text-sm">历史命中率</h2>
        <span className="text-slate-500 text-xs ml-auto">
          追踪 {stats.trackDays} 个交易日 · {stats.total} 只股票
        </span>
      </div>

      {/* 总体指标 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <div className={`text-xl font-bold ${stats.winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}>
            {stats.winRate.toFixed(1)}%
          </div>
          <div className="text-slate-500 text-xs">总命中率</div>
        </div>
        <div className="text-center">
          <div className={`text-xl font-bold ${stats.avgReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {stats.avgReturn >= 0 ? "+" : ""}{stats.avgReturn.toFixed(2)}%
          </div>
          <div className="text-slate-500 text-xs">平均收盘收益</div>
        </div>
        <div className="text-center">
          <div className={`text-xl font-bold ${stats.avgOpenReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {stats.avgOpenReturn >= 0 ? "+" : ""}{stats.avgOpenReturn.toFixed(2)}%
          </div>
          <div className="text-slate-500 text-xs">平均开盘收益</div>
        </div>
      </div>

      {/* 分评级统计 */}
      <div className="border-t border-slate-700/40 pt-3 space-y-2">
        <p className="text-slate-500 text-xs mb-2">各评级命中率</p>
        {stats.labelStats.map(({ label, total, winRate, avgReturn }) => {
          const lc = labelColor[label] || { text: "text-slate-400", bg: "bg-slate-400/15" };
          return (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${lc.text} ${lc.bg} w-16 text-center shrink-0`}>
                {label}
              </span>
              <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(winRate, 100)}%`,
                    backgroundColor: winRate >= 50 ? "#34d399" : "#f87171",
                  }}
                />
              </div>
              <span className="text-slate-300 text-xs w-12 text-right shrink-0">
                {winRate.toFixed(0)}%
              </span>
              <span className={`text-xs w-14 text-right shrink-0 ${avgReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {avgReturn >= 0 ? "+" : ""}{avgReturn.toFixed(1)}%
              </span>
              <span className="text-slate-600 text-xs w-8 text-right shrink-0">
                {total}只
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function Home() {
  const [{ stocks, screenDate }, perfStats, backtestMap] = await Promise.all([
    getScreenData(),
    getPerformanceStats(),
    getPerStockBacktestStats(),
  ]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── 顶部导航栏 ── */}
      <header className="border-b border-slate-800/80 px-4 py-4 sticky top-0 bg-slate-950/90 backdrop-blur-sm z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-red-400 to-amber-400 bg-clip-text text-transparent">
              打板雷达
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">A股涨停股每日精选</p>
          </div>
          <div className="text-right">
            {screenDate && (
              <>
                <p className="text-slate-300 text-sm">{formatDate(screenDate)}</p>
                <p className="text-slate-600 text-xs mt-0.5">
                  {isToday(screenDate) ? "今日数据" : "最近交易日"}
                </p>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── 主内容区 ── */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* ── 历史命中率卡片 ── */}
        {perfStats && <HitRateCard stats={perfStats} />}

        {stocks.length === 0 ? (
          /* 空状态 */
          <div className="text-center py-24">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
              <span className="text-2xl">📊</span>
            </div>
            <p className="text-slate-300 text-lg font-medium">今日暂无数据</p>
            <p className="text-slate-500 text-sm mt-2">
              数据将在每个交易日 15:35 后自动更新
            </p>
          </div>
        ) : (
          <StockList stocks={stocks} backtestMap={backtestMap} />
        )}
      </main>

      {/* ── 风险提示 ── */}
      <footer className="border-t border-slate-800/60 mt-8 px-4 py-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-slate-600 text-xs text-center leading-relaxed">
            风险提示：本工具仅供信息参考，不构成任何投资建议。
            股市有风险，投资需谨慎。所有评分均为量化模型输出，不代表对个股的推荐或背书。
          </p>
        </div>
      </footer>
    </div>
  );
}
