import "./globals.css";

export const metadata = {
  title: "打板雷达 · A股涨停选股",
  description: "每日A股涨停股筛选与评分工具，数据来源东方财富",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full bg-slate-950">{children}</body>
    </html>
  );
}
