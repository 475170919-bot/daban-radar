"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from "recharts";

// ─────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────
function KlineTooltip({ active, payload }) {
  if (!active || !payload || !payload[0]) return null;
  const d = payload[0].payload;
  const isUp = d.close >= d.open;
  const color = isUp ? "#ef4444" : "#22c55e";

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <div className="text-gray-500 mb-1">{d.date}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-gray-400">开盘</span>
        <span className="text-right font-mono">{d.open}</span>
        <span className="text-gray-400">收盘</span>
        <span className="text-right font-mono" style={{ color }}>{d.close}</span>
        <span className="text-gray-400">最高</span>
        <span className="text-right font-mono">{d.high}</span>
        <span className="text-gray-400">最低</span>
        <span className="text-right font-mono">{d.low}</span>
        <span className="text-gray-400">涨跌幅</span>
        <span className="text-right font-mono" style={{ color }}>
          {d.changePct >= 0 ? "+" : ""}{d.changePct}%
        </span>
        <span className="text-gray-400">成交量</span>
        <span className="text-right font-mono">{(d.volume / 10000).toFixed(0)}万手</span>
      </div>
      {d.isLimitUp && (
        <div className="mt-1 text-red-500 font-medium text-center">涨停</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 蜡烛形状：用 Bar 的 shape prop 绘制
// Bar 的 dataKey="range" 给出 [low, high]
// recharts 会把 y 和 height 映射到 [low, high] 区间
// 我们在这个区间内画实体和影线
// ─────────────────────────────────────────────
function CandleShape(props) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { open, close, high, low, isLimitUp } = payload;
  if (open == null || close == null || high == null || low == null) return null;

  const isUp = close >= open;
  const color = isUp ? "#ef4444" : "#22c55e";

  // y 对应 high, y+height 对应 low
  const totalRange = high - low;
  if (totalRange <= 0) {
    // 开盘=收盘=最高=最低，画一条横线
    const centerX = x + width / 2;
    return (
      <line x1={x + 1} y1={y + height / 2} x2={x + width - 1} y2={y + height / 2} stroke={color} strokeWidth={1.5} />
    );
  }

  const pxPerUnit = height / totalRange;
  const centerX = x + width / 2;
  const candleW = Math.max(width * 0.65, 2);

  // 影线：整个高低范围
  const wickTop = y; // high
  const wickBottom = y + height; // low

  // 实体
  const bodyTop = y + (high - Math.max(open, close)) * pxPerUnit;
  const bodyBottom = y + (high - Math.min(open, close)) * pxPerUnit;
  const bodyH = Math.max(bodyBottom - bodyTop, 1);

  return (
    <g>
      {/* 上下影线 */}
      <line x1={centerX} y1={wickTop} x2={centerX} y2={wickBottom} stroke={color} strokeWidth={1} />
      {/* 实体 */}
      <rect
        x={centerX - candleW / 2}
        y={bodyTop}
        width={candleW}
        height={bodyH}
        fill={color}
        stroke={color}
        strokeWidth={0.5}
      />
      {/* 涨停三角标记 */}
      {isLimitUp && (
        <polygon
          points={`${centerX},${wickTop - 8} ${centerX - 3.5},${wickTop - 2} ${centerX + 3.5},${wickTop - 2}`}
          fill="#ef4444"
        />
      )}
    </g>
  );
}

// ─────────────────────────────────────────────
// 主图表组件
// ─────────────────────────────────────────────
export default function KlineChart({ code }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/kline/${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d.klines || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-400 text-sm">
        加载K线数据中...
      </div>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-400 text-sm">
        {error || "暂无K线数据"}
      </div>
    );
  }

  // 给每条数据加上 range 字段供 Bar 使用
  const chartData = data.map((d) => ({
    ...d,
    range: [d.low, d.high],
  }));

  // 价格范围
  const prices = data.flatMap((d) => [d.high, d.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pricePadding = (maxPrice - minPrice) * 0.1;

  // 成交量范围
  const maxVol = Math.max(...data.map((d) => d.volume));

  return (
    <div>
      {/* K线蜡烛图 */}
      <div className="mb-2">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v) => v.slice(5)}
              interval={Math.floor(data.length / 6)}
            />
            <YAxis
              domain={[minPrice - pricePadding, maxPrice + pricePadding]}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v) => v.toFixed(2)}
              width={55}
              allowDataOverflow
            />
            <Tooltip content={<KlineTooltip />} />
            <Bar
              dataKey="range"
              shape={<CandleShape />}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 成交量柱状图 */}
      <ResponsiveContainer width="100%" height={80}>
        <ComposedChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            tickFormatter={(v) => v.slice(5)}
            interval={Math.floor(data.length / 6)}
          />
          <YAxis
            domain={[0, maxVol * 1.1]}
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            tickFormatter={(v) => (v / 10000).toFixed(0) + "万"}
            width={55}
          />
          <Bar dataKey="volume" isAnimationActive={false}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.close >= entry.open ? "rgba(239,68,68,0.5)" : "rgba(34,197,94,0.5)"}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
