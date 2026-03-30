import { createClient } from "@supabase/supabase-js";
import StockList from "./StockList";

// 每5分钟重新验证一次缓存（数据每天只更新一次，5分钟足够）
export const revalidate = 300;

async function getScreenData() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

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

export default async function Home() {
  const { stocks, screenDate } = await getScreenData();

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
          <StockList stocks={stocks} />
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
