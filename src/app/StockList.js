"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import { patternKey } from "./utils/patternUtils";

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function getScoreStyle(score) {
  if (score >= 85) return { text: "text-emerald-600", bg: "bg-emerald-50", hex: "#059669" };
  if (score >= 70) return { text: "text-amber-600",   bg: "bg-amber-50",   hex: "#d97706" };
  if (score >= 50) return { text: "text-gray-500",    bg: "bg-gray-100",   hex: "#6b7280" };
  return               { text: "text-red-500",     bg: "bg-red-50",     hex: "#ef4444" };
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 999;
  const parts = timeStr.split(":");
  if (parts.length < 2) return 999;
  const total = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  return Math.max(0, total - 570);
}

function formatMv(yuan) {
  if (!yuan) return "-";
  return (yuan / 1e8).toFixed(1) + "亿";
}

// ─────────────────────────────────────────────
// 评分子项重计算
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
// ─────────────────────────────────────────────
function getWoodBucketAndFatalTags(stock, subScores) {
  const withRatio = subScores.map((s) => ({
    ...s,
    ratio: s.max > 0 ? s.score / s.max : 0,
  }));

  withRatio.sort((a, b) => a.ratio - b.ratio);
  const bottleneck = withRatio[0];

  const coreLabels = new Set(["封单比", "首封时间", "连板数", "炸板次数"]);
  const fatal = withRatio.filter((s) => coreLabels.has(s.label) && s.ratio < 0.4);
  const fatalMessages = fatal.map((s) => {
    switch (s.label) {
      case "封单比":     return "封盘极弱";
      case "首封时间":   return "首封过慢";
      case "连板数":     return "连板断层";
      case "炸板次数":   return "炸板风险高";
      default:          return "致命缺陷";
    }
  });

  const timeMin = timeToMinutes(stock.first_seal_time);
  const sealRatio = stock.seal_ratio || 0;
  const boardCount = stock.board_count || 1;
  if (timeMin <= 5 && sealRatio < 3 && boardCount === 2) {
    fatalMessages.push("情绪板无资金沉淀");
  }

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
// 明日剧本
// ─────────────────────────────────────────────
function generateTomorrowScript(stock) {
  const timeMin = timeToMinutes(stock.first_seal_time);
  const sealRatio = stock.seal_ratio || 0;
  const boardCount = stock.board_count || 1;
  const openCount = stock.open_count || 0;

  const isSuperEarly = timeMin <= 5;
  const isEarly = timeMin <= 15;
  const isSealWeak = sealRatio < 3;
  const isSealVeryWeak = sealRatio < 2;

  if (isSuperEarly && isSealWeak && boardCount === 2) {
    return '该股首封极早但买盘承接严重不足。明日预期：谨防高开诱多或低开闷杀。操作建议：持筹者若早盘高开不及预期（例如低于3%）或冲高无力，建议果断止盈；空仓者绝对不建议去排板接力3板，炸板风险极高。';
  }

  if (isSealVeryWeak && boardCount >= 2) {
    return '封单比偏弱属于\'先天短板\'。明日预期：更容易在开盘后出现回落或反复换手。操作建议：只看回封质量，不追高；若盘中开板/封单快速流失，优先选择兑现而不是硬扛。';
  }

  if (openCount >= 2) {
    return '炸板次数偏多，说明筹码博弈很激烈。明日预期：冲高回落概率上升。操作建议：不做无脑接力，尤其对3板/高位板更要等强承接信号再动。';
  }

  if (!isEarly && boardCount >= 2) {
    return '首封时间偏晚，市场拉升的主线支撑可能不足。明日预期：高开时更像情绪宣泄而非加速。操作建议：宁可等分歧确认，也尽量避免首小时追涨。';
  }

  return '整体属于可跟踪的强势股，但仍要用\'封单变化 + 开板次数\'做风控锚点。明日预期：偏向高波动，但只要封单能维持且不反复开板，就存在延续机会；反之及时止损。';
}

// ─────────────────────────────────────────────
// 评分环（SVG）
// ─────────────────────────────────────────────

function ScoreRing({ score }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const { hex } = getScoreStyle(score);

  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0">
      <circle cx="24" cy="24" r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle
        cx="24" cy="24" r={r}
        fill="none"
        stroke={hex}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 24 24)"
      />
      <text
        x="24" y="28"
        textAnchor="middle"
        fill={hex}
        fontSize="13"
        fontWeight="700"
        fontFamily="ui-monospace, 'SF Mono', monospace"
      >
        {score}
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────
// 单只股票卡片
// ─────────────────────────────────────────────

function StockCard({ stock, sectorCount, backtestMap }) {
  const [expanded, setExpanded] = useState(false);
  const { text: scoreText, bg: scoreBg } = getScoreStyle(stock.score);
  const subScores = useMemo(() => getSubScores(stock, sectorCount), [stock, sectorCount]);
  const { bottleneckLabel, fatalMessages: clientFatalMessages } = useMemo(
    () => getWoodBucketAndFatalTags(stock, subScores),
    [stock, subScores]
  );

  const dbWarnings = stock.warnings || [];
  const rawWarnings = dbWarnings.length > 0 ? dbWarnings : clientFatalMessages;
  const warnings = rawWarnings.map((w) => typeof w === "string" ? w.replace(/^⚠️?\s*/, "") : w);

  const sealColor =
    stock.seal_ratio >= 10 ? "text-emerald-600" :
    stock.seal_ratio >= 5  ? "text-amber-600"   : "text-gray-500";

  const timeMin = timeToMinutes(stock.first_seal_time);
  const timeColor =
    timeMin <= 5  ? "text-emerald-600" :
    timeMin <= 30 ? "text-amber-600"   : "text-gray-500";

  // 板块信息文字
  const sectorInfo = stock.sector_total > 1
    ? `${stock.concept}板块${stock.sector_total}只 排名#${stock.sector_rank}`
    : null;

  return (
    <div className="bg-[#f8f9fa] border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 transition-colors">
      {/* ── 主行 ── */}
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        {/* 左侧：评分环 */}
        <ScoreRing score={stock.score} />

        {/* 中间：股票信息（水平排列） */}
        <div className="flex-1 min-w-0">
          {/* 第一行：名称 + 代码 + 标签 */}
          <div className="flex items-center gap-2 flex-nowrap overflow-hidden">
            <span className="text-gray-900 font-semibold text-sm whitespace-nowrap">
              {stock.name}
            </span>
            <span className="text-gray-400 text-xs font-mono whitespace-nowrap">{stock.code}</span>

            {stock.board_count > 1 && (
              <span className="px-1.5 py-0.5 bg-red-50 text-red-500 text-[11px] rounded font-medium whitespace-nowrap">
                {stock.board_count}连板
              </span>
            )}

            {stock.open_count > 0 && (
              <span className="px-1.5 py-0.5 bg-orange-50 text-orange-500 text-[11px] rounded whitespace-nowrap">
                炸{stock.open_count}次
              </span>
            )}

            {stock.sector_rank === 1 && stock.sector_total > 1 && (
              <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[11px] rounded font-medium whitespace-nowrap">
                龙头
              </span>
            )}
            {stock.sector_rank > 1 && stock.sector_rank > Math.ceil((stock.sector_total || 1) / 2) && (
              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[11px] rounded whitespace-nowrap">
                跟风
              </span>
            )}
          </div>

          {/* 第二行：指标横排，用 · 分隔 */}
          <div className="flex items-center gap-0 mt-1 text-xs whitespace-nowrap overflow-hidden text-ellipsis">
            {stock.concept && (
              <span className="text-gray-400">{stock.concept}</span>
            )}
            <span className="text-gray-300 mx-1.5">·</span>
            <span className={sealColor}>封单{stock.seal_ratio?.toFixed(1)}%</span>
            <span className="text-gray-300 mx-1.5">·</span>
            <span className={timeColor}>首封{stock.first_seal_time?.slice(0, 5) || "-"}</span>
            <span className="text-gray-300 mx-1.5">·</span>
            <span className="text-gray-400">市值{formatMv(stock.circ_mv)}</span>
            {sectorInfo && (
              <>
                <span className="text-gray-300 mx-1.5">·</span>
                <span className="text-gray-400">{sectorInfo}</span>
              </>
            )}
          </div>
        </div>

        {/* 右侧：评级标签 + 预警 + 箭头，竖向排列 */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${scoreText} ${scoreBg}`}>
            {stock.score_label}
          </span>
          {warnings.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-500 text-white text-[10px] font-semibold whitespace-nowrap">
              {warnings[0]}
            </span>
          )}
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          }
        </div>
      </button>

      {/* ── 展开：评分细节 ── */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-200">
          <div className="mt-3 space-y-2">
            {subScores.map(({ label, value, score, max }) => {
              const pct = (score / max) * 100;
              const barHex =
                pct >= 80 ? "#059669" : pct >= 50 ? "#d97706" : "#9ca3af";
              return (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="w-16 text-gray-500 shrink-0 text-xs">{label}</span>
                  <span className="w-14 text-gray-700 shrink-0 text-right text-xs font-mono">{value}</span>
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: barHex }}
                    />
                  </div>
                  <span className="text-gray-400 text-xs w-11 text-right shrink-0 font-mono">
                    {score}/{max}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 总分行 */}
          <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs">综合评分</span>
              <span className={`font-bold text-base font-mono ${scoreText}`}>{stock.score}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${scoreText} ${scoreBg}`}>{stock.score_label}</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {warnings.length > 0 && warnings.map((w) => (
                <span key={w} className="px-2 py-0.5 rounded bg-red-500 text-white text-[11px] font-semibold">
                  {w}
                </span>
              ))}
            </div>
          </div>

          {/* 明日剧本 */}
          <div className="mt-3 bg-white border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-gray-600 text-xs font-medium">操作建议</span>
              <span className="text-gray-300 text-[10px]">规则引擎自动生成</span>
            </div>
            <p className="text-gray-700 text-xs leading-relaxed">
              {stock.prediction || generateTomorrowScript(stock)}
            </p>
          </div>

          {/* 历史相似形态回测 */}
          {(() => {
            if (!backtestMap) return null;
            const pk = patternKey(stock.board_count || 1, stock.first_seal_time || "", stock.seal_ratio || 0);
            const stats = backtestMap[pk];
            if (!stats || stats.sampleCount === 0) {
              return (
                <p className="mt-2 text-gray-400 text-xs">
                  历史回测：该形态近3个月样本不足，暂无统计数据。
                </p>
              );
            }

            const winColor = stats.winRate >= 60 ? "text-emerald-600" : stats.winRate >= 40 ? "text-amber-600" : "text-red-500";
            const avgColor = stats.avgCloseReturn >= 0 ? "text-emerald-600" : "text-red-500";

            return (
              <div className="mt-3 bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-600 text-xs font-medium">历史相似形态回测</span>
                  <span className="text-gray-300 text-[10px]">近3个月</span>
                </div>
                <p className="text-gray-600 text-xs leading-relaxed">
                  相似形态共出现 <span className="text-gray-900 font-medium font-mono">{stats.sampleCount}</span> 次，
                  次日盈利率 <span className={`font-medium font-mono ${winColor}`}>{stats.winRate.toFixed(1)}%</span>，
                  平均收盘涨幅 <span className={`font-medium font-mono ${avgColor}`}>{stats.avgCloseReturn >= 0 ? "+" : ""}{stats.avgCloseReturn.toFixed(2)}%</span>
                  {stats.avgOpenReturn !== undefined && (
                    <>，平均开盘涨幅 <span className={`font-medium font-mono ${stats.avgOpenReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{stats.avgOpenReturn >= 0 ? "+" : ""}{stats.avgOpenReturn.toFixed(2)}%</span></>
                  )}
                </p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 统计概览（横排5格）
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
    { label: "涨停总数",   value: total,     unit: "只", color: "text-gray-900" },
    { label: "强烈关注",   value: strong,    unit: "只", color: "text-emerald-600" },
    { label: "值得观察",   value: watch,     unit: "只", color: "text-amber-600" },
    { label: "连板股",     value: multiBoard, unit: "只", color: "text-red-500" },
    { label: "平均封单比", value: avgSeal,   unit: "%",  color: "text-gray-900" },
  ];

  return (
    <div className="flex items-stretch gap-3 mb-6 overflow-x-auto">
      {stats.map(({ label, value, unit, color }) => (
        <div
          key={label}
          className="flex-1 min-w-0 bg-[#f8f9fa] border border-gray-200 rounded-xl px-3 py-3 text-center"
        >
          <div className={`text-xl font-bold font-mono ${color}`}>
            {value}
            <span className="text-xs font-normal ml-0.5">{unit}</span>
          </div>
          <div className="text-gray-400 text-[11px] mt-0.5 whitespace-nowrap">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// 筛选排序栏（浅灰胶囊样式）
// ─────────────────────────────────────────────

function FilterBar({ sortBy, setSortBy, filterLabel, setFilterLabel, total, filtered }) {
  const sortOptions = [
    { value: "score",           label: "评分" },
    { value: "seal_ratio",      label: "封单比" },
    { value: "board_count",     label: "连板数" },
    { value: "first_seal_time", label: "首封时间" },
  ];

  const labelOptions = [
    { value: "all",      label: "全部" },
    { value: "强烈关注", label: "强烈关注" },
    { value: "值得观察", label: "值得观察" },
    { value: "一般",     label: "一般" },
    { value: "谨慎",     label: "谨慎" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* 排序 */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-full px-1 py-0.5">
        <span className="text-gray-400 text-[11px] px-2">排序</span>
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
              sortBy === opt.value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 筛选 */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-full px-1 py-0.5 flex-wrap">
        <span className="text-gray-400 text-[11px] px-2">筛选</span>
        {labelOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilterLabel(opt.value)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
              filterLabel === opt.value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {filterLabel !== "all" && (
        <span className="text-gray-400 text-xs">
          显示 {filtered}/{total} 只
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export default function StockList({ stocks, backtestMap }) {
  const [sortBy, setSortBy]           = useState("score");
  const [filterLabel, setFilterLabel] = useState("all");

  const sectorCounts = useMemo(() => {
    const counts = {};
    stocks.forEach((s) => {
      if (s.concept) counts[s.concept] = (counts[s.concept] || 0) + 1;
    });
    return counts;
  }, [stocks]);

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
        <div className="text-center py-16 text-gray-400">
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
              backtestMap={backtestMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}
