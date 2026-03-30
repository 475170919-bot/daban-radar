# 打板雷达 (DaBan Radar)

## About
A daily A-share limit-up stock screening tool. Fetches data from AKShare
(东方财富), scores each stock by limit-up quality, and displays ranked
results through a web interface.

## User Context
The developer has a NON-TECHNICAL background and is using AI-assisted development.
- Always provide complete, runnable code — never partial snippets
- Explain what each file does and why in simple Chinese
- When fixing bugs, explain the root cause simply
- Prefer simple solutions over clever ones
- All UI text should be in Chinese (Simplified)

## Tech Stack
- **Data Pipeline**: Python 3.11 + AKShare + supabase-py
- **Database**: Supabase (PostgreSQL)
- **Frontend**: Next.js 14+ with App Router
- **Styling**: Tailwind CSS (dark theme, slate palette)
- **Charts**: Recharts
- **Deployment**: Vercel (frontend) + GitHub Actions (data cron)

## Key Rules
1. All data fetching happens in Python scripts, NOT in Next.js
2. Python scripts run daily via GitHub Actions at 15:35 CST
3. Next.js only reads from Supabase — never calls AKShare directly
4. Dark theme only — bg-slate-950 background
5. Every component needs a loading and empty state
6. All monetary values display in 亿 (hundred millions)
7. Never expose Supabase service key to browser — use anon key only
8. Include 风险提示 disclaimer on every page
9. Filter out ST stocks and new IPO stocks (上市不足30天)

## Scoring Weights
- 封单比 (seal ratio): 30%
- 首封时间 (first seal time): 25%
- 连板数 (consecutive boards): 20%
- 炸板次数 (break count): 15%
- 板块效应 (sector strength): 10%

## Score Labels
- ≥85: 强烈关注 (emerald)
- 70-84: 值得观察 (amber)
- 50-69: 一般 (slate)
- <50: 谨慎 (red)
