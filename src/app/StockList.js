"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react";

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function getScoreStyle(score) {
  if (score >= 85) return { text: "text-emerald-400", bg: "bg-emerald-400/10", hex: "#34d399" };
  if (score >= 70) return { text: "text-amber-400",   bg: "bg-amber-400/10",   hex: "#fbbf24" };
  if (score >= 50) return { text: "text-slate-400",   bg: "bg-slate-400/10",   hex: "#94a3b8" };
  return               { text: "text-red-400",    bg: "bg-red-400/10",    hex: "#f87171" };
}

// 把 "HH:MM:SS" 转换成距开盘 9:30 的分钟数
function timeToMinutes(timeStr) {
  if (!timeStr) return 999;
  const parts = timeStr.split(":");
  if (parts.length < 2) return 999;
  const total = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  return Math.max(0, total - 570); // 570 = 9×60+30
}

// 把流通市值（元）转成"XX.X亿"
function formatMv(yuan) {
  if (!yuan) return "-";
  return (yuan / 1e8).toFixed(1) + "亿";
}

// ─────────────────────────────────────────────
// 评分子项重计算（与 Python 脚本逻辑一致）
// ─────────────────────────────────────────────

function getSubScores(stock, sectorCount) {
  const sr = stock.seal_ratio || 0;
  const sealScore = sr >= 15 ? 30 : sr >= 10 ? 25 : sr >= 5 ? 18 : sr >= 2 ? 10 : 3;

  const min = timeToMinutes(stock.first_seal_time);
  const timeScore = min <= 2 ? 25 : min <= 15 ? 22 : min <= 60 ? 16 : min <= 120 ? 10 : 5;

  const bc = stock.board_count || 1;
  const boardScore = bc === 1 ? 8 : bc === 2 ? 16 : bc === 3 ? 20 : 14;

  const oc = stock.open_count || 0;
  const openScore = oc === 0 ? 15 : oc === 1 ? 8 : oc === 2 ? 3 : 0;

  const sc = sectorCount || 0;
  const sectorScore = sc >= 5 ? 10 : sc >= 3 ? 7 : sc >= 1 ? 4 : 1;

  return [
    { label: "封单比",   value: `${sr.toFixed(1)}%`,              score: sealScore,   max: 30 },
    { label: "首封时间", value: stock.first_seal_time?.slice(0, 5) || "-", score: timeScore, max: 25 },
    { label: "连板数",   value: `${bc}板`,                        score: boardScore,  max: 20 },
    { label: "炸板次数", value: `${oc}次`,                        score: openScore,   max: 15 },
    { label: "板块效应", value: `${sc}只同涨`,                    score: sectorScore, max: 10 },
  ];
}

// ─────────────────────────────────────────────
// 木桶效应 & 致命缺陷标签
// 红色：核心子项低于满分40%
// 黑色：展示当前“瓶颈指标”（木桶效应）
// ─────────────────────────────────────────────
function getWoodBucketAndFatalTags(stock, subScores) {
  const withRatio = subScores.map((s) => ({
    ...s,
    ratio: s.max > 0 ? s.score / s.max : 0,
  }));

  // 瓶颈指标：ratio 最小
  withRatio.sort((a, b) => a.ratio - b.ratio);
  const bottleneck = withRatio[0];

  // 致命缺陷：只针对“核心子项”
  // 不把“板块效应”纳入致命触发，避免过度误伤。
  const coreLabels = new Set(["封单比", "首封时间", "连板数", "炸板次数"]);
  const fatal = withRatio.filter((s) => coreLabels.has(s.label) && s.ratio < 0.4);
  const fatalMessages = fatal.map((s) => {
    switch (s.label) {
      case "封单比":
        return "⚠️ 封盘极弱";
      case "首封时间":
        return "⚠️ 首封过慢";
      case "连板数":
        return "⚠️ 连板断层";
      case "炸板次数":
        return "⚠️ 炸板风险高";
      default:
        return "⚠️ 致命缺陷";
    }
  });

  // 特例：你强调的“首封极早 + 封单极弱 + 2连板”
  const timeMin = timeToMinutes(stock.first_seal_time);
  const sealRatio = stock.seal_ratio || 0;
  const boardCount = stock.board_count || 1;
  const isSuperEarly = timeMin <= 5;
  const isSealWeak = sealRatio < 3;
  if (isSuperEarly && isSealWeak && boardCount === 2) {
    fatalMessages.push("⚠️ 情绪板无资金沉淀");
  }

  // 去重保持顺序
  const deduped = [];
  for (const m of fatalMessages) {
    if (!deduped.includes(m)) deduped.push(m);
  }

  return {
    bottleneckLabel: bottleneck?.label ? `木桶效应：${bottleneck.label}` : "木桶效应：—",
    fatalMessages: deduped,
  };
}

// ─────────────────────────────────────────────
// 次日盘前推演与执行锚点（明日剧本）
// 基于当日关键维度的“组合规则”生成文本
// ─────────────────────────────────────────────
function generateTomorrowScript(stock) {
  const timeMin = timeToMinutes(stock.first_seal_time);
  const sealRatio = stock.seal_ratio || 0;
  const boardCount = stock.board_count || 1;
  const openCount = stock.open_count || 0;

  const isSuperEarly = timeMin <= 5; // 近似“极早”
  const isEarly = timeMin <= 15; // 早盘内
  const isSealWeak = sealRatio < 3; // 你给的口径：封单比<3%算极弱
  const isSealVeryWeak = sealRatio < 2; // 进一步加强

  if (isSuperEarly && isSealWeak && boardCount === 2) {
    return "该股首封极早但买盘承接严重不足。明日预期：谨防高开诱多或低开闷杀。操作建议：持筹者若早盘高开不及预期（例如低于3%）或冲高无力，建议果断止盈；空仓者绝对不建议去排板接力3板，炸板风险极高。";
  }

  if (isSealVeryWeak && boardCount >= 2) {
    return "封单比偏弱属于“先天短板”。明日预期：更容易在开盘后出现回落或反复换手。操作建议：只看回封质量，不追高；若盘中开板/封单快速流失，优先选择兑现而不是硬扛。";
  }

  if (openCount >= 2) {
    return "炸板次数偏多，说明筹码博弈很激烈。明日预期：冲高回落概率上升。操作建议：不做无脑接力，尤其对3板/高位板更要等强承接信号再动。";
  }

  if (!isEarly && boardCount >= 2) {
    return "首封时间偏晚，市场拉升的主线支撑可能不足。明日预期：高开时更像情绪宣泄而非加速。操作建议：宁可等分歧确认，也尽量避免首小时追涨。";
  }

  // 默认保守模板
  return "整体属于可跟踪的强势股，但仍要用“封单变化 + 开板次数”做风控锚点。明日预期：偏向高波动，但只要封单能维持且不反复开板，就存在延续机会；反之及时止损。";
}

// ─────────────────────────────────────────────
// 评分环（SVG）
// ─────────────────────────────────────────────

function ScoreRing({ score }) {
  const r = 24;
  const circ = 2 * Math.PI * r; // ≈150.8
  const offset = circ * (1 - score / 100);
  const { hex } = getScoreStyle(score);

  return (
    <svg width="60" height="60" viewBox="0 0 60 60" className="shrink-0">
      {/* 背景轨道 */}
      <circle cx="30" cy="30" r={r} fill="none" stroke="#1e293b" strokeWidth="5" />
      {/* 进度弧 */}
      <circle
        cx="30" cy="30" r={r}
        fill="none"
        stroke={hex}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 30 30)"
      />
      {/* 分数文字 */}
      <text
        x="30" y="35"
        textAnchor="middle"
        fill={hex}
        fontSize="15"
        fontWeight="700"
        fontFamily="var(--font-geist-sans), sans-serif"
      >
        {score}
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────
// 单只股票卡片
// ─────────────────────────────────────────────

function StockCard({ stock, sectorCount, conceptFirstSealRank, conceptFirstSealTotal, pkSuspected, backtestStats }) {
  const [expanded, setExpanded] = useState(false);
  const { text: scoreText, bg: scoreBg } = getScoreStyle(stock.score);
  const subScores = useMemo(() => getSubScores(stock, sectorCount), [stock, sectorCount]);
  const { bottleneckLabel, fatalMessages: clientFatalMessages } = useMemo(
    () => getWoodBucketAndFatalTags(stock, subScores),
    [stock, subScores]
  );

  // 优先使用数据库存储的 warnings（后端计算），没有则回退到客户端计算
  const dbWarnings = stock.warnings || [];
  const warnings = dbWarnings.length > 0 ? dbWarnings : clientFatalMessages;

  // 封单比颜色
  const sealColor =
    stock.seal_ratio >= 10 ? "text-emerald-400" :
    stock.seal_ratio >= 5  ? "text-amber-400"   : "text-slate-400";

  // 首封时间颜色
  const timeMin = timeToMinutes(stock.first_seal_time);
  const timeColor =
    timeMin <= 5  ? "text-emerald-400" :
    timeMin <= 30 ? "text-amber-400"   : "text-slate-400";

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden hover:border-slate-600/60 transition-colors">
      {/* ── 主行（点击展开/收起） ── */}
      <button
        className="w-full text-left p-4 flex items-center gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <ScoreRing score={stock.score} />

        {/* 股票基本信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-100 font-semibold text-base leading-tight">
              {stock.name}
            </span>
            <span className="text-slate-500 text-xs">{stock.code}</span>

            {/* 连板标签 */}
            {stock.board_count > 1 && (
              <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded font-medium">
                {stock.board_count}连板
              </span>
            )}

            {/* 炸板警告 */}
            {stock.open_count > 0 && (
              <span className="px-1.5 py-0.5 bg-orange-500/15 text-orange-400 text-xs rounded">
                炸{stock.open_count}次
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-sm flex-wrap">
            {stock.concept && (
              <span className="text-slate-500 text-xs">{stock.concept}</span>
            )}
            <span className={`font-medium ${sealColor}`}>
              封单{stock.seal_ratio?.toFixed(1)}%
            </span>
            <span className={timeColor}>
              首封{stock.first_seal_time?.slice(0, 5) || "-"}
            </span>
            <span className="text-slate-500 text-xs">
              市值{formatMv(stock.circ_mv)}
            </span>

            {/* 板块内地位（同梯队PK） */}
            {conceptFirstSealRank && conceptFirstSealTotal ? (
              <span className={`text-xs ${pkSuspected ? "text-red-400" : "text-slate-500"}`}>
                板块内地位：首封第{conceptFirstSealRank}/{conceptFirstSealTotal}名
                {pkSuspected ? "（疑似套利）" : ""}
              </span>
            ) : null}
          </div>
        </div>

        {/* 评级 + 展开箭头 */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`hidden sm:inline-block px-2 py-1 rounded text-xs font-medium ${scoreText} ${scoreBg}`}
          >
            {stock.score_label}
          </span>
          {/* 致命缺陷预警标签（红底白字，评分旁边） */}
          {warnings.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              {warnings.slice(0, 2).map((w) => (
                <span
                  key={w}
                  className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px] font-semibold"
                >
                  ⚠ {typeof w === "string" ? w.replace(/^⚠️?\s*/, "") : w}
                </span>
              ))}
            </div>
          )}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-slate-500" />
            : <ChevronDown className="w-4 h-4 text-slate-500" />
          }
        </div>
      </button>

      {/* ── 展开：评分细节 ── */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-700/40">
          <div className="mt-3 space-y-2.5">
            {subScores.map(({ label, value, score, max }) => {
              const pct = (score / max) * 100;
              const barHex =
                pct >= 80 ? "#34d399" : pct >= 50 ? "#fbbf24" : "#94a3b8";
              return (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="w-16 text-slate-400 shrink-0">{label}</span>
                  <span className="w-14 text-slate-300 shrink-0 text-right">{value}</span>
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: barHex }}
                    />
                  </div>
                  <span className="text-slate-500 text-xs w-11 text-right shrink-0">
                    {score}/{max}分
                  </span>
                </div>
              );
            })}
          </div>

          {/* 总分行 */}
          <div className="mt-3 pt-3 border-t border-slate-700/30 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="text-slate-500 text-sm shrink-0">综合评分</span>
              <span className={`font-bold text-lg ${scoreText}`}>{stock.score}分 · {stock.score_label}</span>
            </div>

            {/* 致命缺陷预警标签（红底白字） */}
            {warnings.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {warnings.map((w) => (
                  <span key={w} className="px-2 py-1 rounded bg-red-600 text-white text-xs font-semibold">
                    ⚠ {typeof w === "string" ? w.replace(/^⚠️?\s*/, "") : w}
                  </span>
                ))}
              </div>
            )}
            {/* 木桶效应 */}
            <span className="px-2 py-1 rounded border border-slate-700/60 bg-slate-950/40 text-slate-200 text-xs font-medium">
              {bottleneckLabel}
            </span>
          </div>

          {/* 明日剧本 */}
          <div className="mt-3 bg-slate-950/20 border border-slate-700/40 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-slate-300 text-xs font-medium">次日盘前推演与执行锚点</span>
              <span className="text-slate-500 text-[10px]">基于当日维度自动生成</span>
            </div>
            <p className="text-slate-100 text-sm leading-relaxed">
              {generateTomorrowScript(stock)}
            </p>
          </div>

          {/* 历史相似形态回测（灰色小字） */}
          {(() => {
            const timeMin = timeToMinutes(stock.first_seal_time);
            const isSimilarPattern =
              (stock.board_count || 1) === 2 &&
              timeMin <= 15 && // 9:45 前
              (stock.seal_ratio || 0) < 3; // 封单比低于3%

            if (!isSimilarPattern) return null;
            if (!backtestStats) {
              return (
                <p className="mt-2 text-slate-500 text-xs">
                  历史回测：暂无可用样本，先以风险提示为先。
                </p>
              );
            }

            const count = backtestStats.count ?? 0;
            if (count === 0) {
              return (
                <p className="mt-2 text-slate-500 text-xs">
                  历史回测：样本不足（近一年匹配条件为0次）。
                </p>
              );
            }

            return (
              <p className="mt-2 text-slate-500 text-xs leading-relaxed">
                历史回测：过去一年出现相似数据模型共 {count} 次，次日晋级3连板成功率仅为{" "}
                {backtestStats.next3Rate.toFixed(1)}%，次日收阴（或炸板）概率高达{" "}
                {backtestStats.badDayRate.toFixed(1)}%。
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 统计概览（顶部4格）
// ─────────────────────────────────────────────

function StatsHeader({ stocks }) {
  const total      = stocks.length;
  const strong     = stocks.filter((s) => s.score >= 85).length;
  const watch      = stocks.filter((s) => s.score >= 70 && s.score < 85).length;
  const multiBoard = stocks.filter((s) => s.board_count >= 2).length;
  const avgSeal    = total > 0
    ? (stocks.reduce((sum, s) => sum + (s.seal_ratio || 0), 0) / total).toFixed(1)
    : "0";

  const stats = [
    { label: "涨停总数",   value: total,     unit: "只", color: "text-slate-100" },
    { label: "强烈关注",   value: strong,    unit: "只", color: "text-emerald-400" },
    { label: "值得观察",   value: watch,     unit: "只", color: "text-amber-400" },
    { label: "连板股",     value: multiBoard, unit: "只", color: "text-red-400" },
    { label: "平均封单比", value: avgSeal,   unit: "%",  color: "text-slate-100" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-6">
      {stats.map(({ label, value, unit, color }) => (
        <div
          key={label}
          className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 text-center"
        >
          <div className={`text-2xl font-bold ${color}`}>
            {value}
            <span className="text-sm font-normal ml-0.5">{unit}</span>
          </div>
          <div className="text-slate-500 text-xs mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// 筛选排序栏
// ─────────────────────────────────────────────

function FilterBar({ sortBy, setSortBy, filterLabel, setFilterLabel, total, filtered }) {
  const sortOptions = [
    { value: "score",           label: "评分" },
    { value: "seal_ratio",      label: "封单比" },
    { value: "board_count",     label: "连板数" },
    { value: "first_seal_time", label: "首封时间" },
  ];

  const labelOptions = [
    { value: "all",    label: "全部",     activeClass: "bg-slate-600 text-slate-100" },
    { value: "强烈关注", label: "强烈关注", activeClass: "bg-emerald-400/20 text-emerald-400" },
    { value: "值得观察", label: "值得观察", activeClass: "bg-amber-400/20 text-amber-400" },
    { value: "一般",    label: "一般",     activeClass: "bg-slate-600 text-slate-100" },
    { value: "谨慎",    label: "谨慎",     activeClass: "bg-red-400/20 text-red-400" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* 排序 */}
      <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg p-1">
        <span className="text-slate-500 text-xs px-2">排序</span>
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              sortBy === opt.value
                ? "bg-slate-600 text-slate-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 筛选 */}
      <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg p-1 flex-wrap">
        <span className="text-slate-500 text-xs px-2">筛选</span>
        {labelOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilterLabel(opt.value)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filterLabel === opt.value
                ? opt.activeClass
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 计数提示 */}
      {filterLabel !== "all" && (
        <span className="text-slate-500 text-xs">
          显示 {filtered}/{total} 只
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 主组件（由 page.js 调用）
// ─────────────────────────────────────────────

export default function StockList({ stocks, backtestStats }) {
  const [sortBy, setSortBy]           = useState("score");
  const [filterLabel, setFilterLabel] = useState("all");

  // 计算每个行业有几只股票涨停（用于板块效应显示）
  const sectorCounts = useMemo(() => {
    const counts = {};
    stocks.forEach((s) => {
      if (s.concept) counts[s.concept] = (counts[s.concept] || 0) + 1;
    });
    return counts;
  }, [stocks]);

  // 板块内地位（同板块首封时间排名 + 早封不封死疑似套利）
  const conceptPkByCode = useMemo(() => {
    const byConcept = {};
    stocks.forEach((s) => {
      if (!s.concept) return;
      byConcept[s.concept] = byConcept[s.concept] || [];
      byConcept[s.concept].push(s);
    });

    const map = {};
    for (const concept of Object.keys(byConcept)) {
      const list = byConcept[concept];
      list.sort((a, b) => timeToMinutes(a.first_seal_time) - timeToMinutes(b.first_seal_time));
      const total = list.length;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const sealRatio = s.seal_ratio || 0;
        // “疑似套利”：它首封最早，但封单比比同板块所有晚封票都还低
        const minLateSeal =
          i === 0 && list.length > 1
            ? Math.min(...list.slice(1).map((x) => x.seal_ratio || 0))
            : null;

        const pkSuspected = i === 0 && minLateSeal !== null && sealRatio < minLateSeal;
        map[s.code] = {
          conceptFirstSealRank: i + 1,
          conceptFirstSealTotal: total,
          pkSuspected,
        };
      }
    }
    return map;
  }, [stocks]);

  // 筛选 + 排序
  const displayList = useMemo(() => {
    let list = filterLabel === "all"
      ? [...stocks]
      : stocks.filter((s) => s.score_label === filterLabel);

    list.sort((a, b) => {
      if (sortBy === "score")       return (b.score || 0) - (a.score || 0);
      if (sortBy === "seal_ratio")  return (b.seal_ratio || 0) - (a.seal_ratio || 0);
      if (sortBy === "board_count") return (b.board_count || 0) - (a.board_count || 0);
      if (sortBy === "first_seal_time") {
        return timeToMinutes(a.first_seal_time) - timeToMinutes(b.first_seal_time);
      }
      return 0;
    });

    return list;
  }, [stocks, sortBy, filterLabel]);

  return (
    <div>
      <StatsHeader stocks={stocks} />

      <FilterBar
        sortBy={sortBy}
        setSortBy={setSortBy}
        filterLabel={filterLabel}
        setFilterLabel={setFilterLabel}
        total={stocks.length}
        filtered={displayList.length}
      />

      {displayList.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>暂无符合条件的股票</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayList.map((stock) => (
            <StockCard
              key={stock.code}
              stock={stock}
              sectorCount={(sectorCounts[stock.concept] || 1) - 1}
              conceptFirstSealRank={conceptPkByCode[stock.code]?.conceptFirstSealRank}
              conceptFirstSealTotal={conceptPkByCode[stock.code]?.conceptFirstSealTotal}
              pkSuspected={conceptPkByCode[stock.code]?.pkSuspected}
              backtestStats={backtestStats}
            />
          ))}
        </div>
      )}
    </div>
  );
}
