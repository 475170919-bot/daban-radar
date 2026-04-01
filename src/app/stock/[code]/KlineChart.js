"use client";

import { useEffect, useState, useRef } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  Customized,
  Rectangle,
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
// 蜡烛图自定义渲染（通过 Customized 访问 chart 内部坐标）
// ─────────────────────────────────────────────
function CandleSticks({ formattedGraphicalItems, xAxisMap, yAxisMap }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis || !yAxis) return null;

  const xScale = xAxis.scale;
  const yScale = yAxis.scale;
  const bandwidth = xAxis.bandwidth ? xAxis.bandwidth() : 8;

  // 从第一个 graphical item 取数据
  const item = formattedGraphicalItems && formattedGraphicalItems[0];
  if (!item) return null;
  const data = item.props?.data || [];

  return (
    <g>
      {data.map((entry, i) => {
        const { open, close, high, low, isLimitUp, date } = entry;
        if (open == null || close == null) return null;

        const isUp = close >= open;
        const color = isUp ? "#ef4444" : "#22c55e";

        const x = xScale(date);
        if (x == null) return null;

        const centerX = x + bandwidth / 2;
        const candleWidth = Math.max(bandwidth * 0.7, 3);

        const bodyTop = yScale(Math.max(open, close));
        const bodyBottom = yScale(Math.min(open, close));
        const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
        const wickTop = yScale(high);
        const wickBottom = yScale(low);

        return (
          <g key={i}>
            {/* 上下影线 */}
            <line
              x1={centerX} y1={wickTop}
              x2={centerX} y2={wickBottom}
              stroke={color} strokeWidth={1}
            />
            {/* 实体 */}
            <rect
              x={centerX - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              fill={color}
              stroke={color}
              strokeWidth={0.5}
            />
            {/* 涨停标记 */}
            {isLimitUp && (
              <polygon
                points={`${centerX},${wickTop - 10} ${centerX - 4},${wickTop - 4} ${centerX + 4},${wickTop - 4}`}
                fill="#ef4444"
                stroke="#fff"
                strokeWidth={0.5}
              />
            )}
          </g>
        );
      })}
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
          <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v) => v.slice(5)}
              interval={Math.floor(data.length / 6)}
              type="category"
            />
            <YAxis
              domain={[minPrice - pricePadding, maxPrice + pricePadding]}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v) => v.toFixed(2)}
              width={55}
            />
            <Tooltip content={<KlineTooltip />} />
            {/* 不可见的 Bar 用于驱动 tooltip 和坐标轴 */}
            <Bar dataKey="close" fill="transparent" isAnimationActive={false} />
            {/* 自定义蜡烛绘制 */}
            <Customized component={CandleSticks} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 成交量柱状图 */}
      <ResponsiveContainer width="100%" height={80}>
        <ComposedChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
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
            {data.map((entry, i) => (
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
