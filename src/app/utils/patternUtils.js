/**
 * 历史相似形态回测 — 分档工具函数
 * 与 Python 评分算法的阈值一致，用于前后端共享
 */

// 首封时间分档（距 9:30 的分钟数）
export function getTimeBracket(timeStr) {
  if (!timeStr) return "afternoon";
  const parts = timeStr.split(":");
  if (parts.length < 2) return "afternoon";
  const totalMin = parseInt(parts[0]) * 60 + parseInt(parts[1]) - 570; // 570 = 9*60+30
  if (totalMin <= 2) return "flash";       // 秒板
  if (totalMin <= 15) return "early";      // 早盘15分钟
  if (totalMin <= 60) return "mid";        // 上午
  if (totalMin <= 120) return "late";      // 午前
  return "afternoon";                       // 午后
}

// 封单比分档
export function getSealBracket(sealRatio) {
  if (sealRatio >= 15) return "very_high";
  if (sealRatio >= 10) return "high";
  if (sealRatio >= 5) return "medium";
  if (sealRatio >= 2) return "low";
  return "very_low";
}

// 生成形态特征 key
export function patternKey(boardCount, timeStr, sealRatio) {
  return `${boardCount}|${getTimeBracket(timeStr)}|${getSealBracket(sealRatio)}`;
}
