import { useState, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/contexts/SettingsContext";
import type { AppSettings } from "@/lib/settings-defaults";
import {
  Settings, SlidersHorizontal, ShieldAlert, Search,
  Target, BarChart2, Palette, Database, Check,
  Loader2, RotateCcw, Download, ChevronDown,
  Clock, TrendingUp, Bookmark, Briefcase, Lock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type SelectOption = { label: string; value: string | number };

type SettingDef =
  | { key: string; label: string; description?: string; type: "toggle"; default: boolean }
  | { key: string; label: string; description?: string; type: "select"; default: string | number; options: SelectOption[] }
  | { key: string; label: string; description?: string; type: "number"; default: number; min?: number; max?: number; step?: number; unit?: string }
  | { key: string; label: string; description?: string; type: "slider"; default: number; min: number; max: number; step?: number; unit?: string }
  | { key: string; label: string; description?: string; type: "multiselect"; default: string[]; options: SelectOption[] }
  | { key: string; label: string; description?: string; type: "toggleGroup"; default: Record<string, boolean>; options: SelectOption[] }
  | { key: string; label: string; description?: string; type: "info" };

type CategoryDef = {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  settings: SettingDef[];
};

// ── Category + Settings Registry ──────────────────────────────────────────

const CATEGORIES: CategoryDef[] = [
  {
    id: "general",
    label: "General",
    icon: <Settings size={14} />,
    description: "Basic app behavior, locale, and refresh settings.",
    settings: [
      { key: "defaultPage", label: "Default page", description: "Page shown on launch", type: "select", default: "/", options: [{ label: "Dashboard", value: "/" }, { label: "Screener", value: "/screener" }, { label: "Analysis", value: "/scanner" }, { label: "Watchlist", value: "/watchlist" }, { label: "Positions", value: "/positions" }] },
      { key: "timezone", label: "Timezone", description: "Used for market hours and timestamps", type: "select", default: "ET", options: [{ label: "Eastern (ET)", value: "ET" }, { label: "Central (CT)", value: "CT" }, { label: "Mountain (MT)", value: "MT" }, { label: "Pacific (PT)", value: "PT" }, { label: "UTC", value: "UTC" }] },
      { key: "dateFormat", label: "Date format", type: "select", default: "MM/DD/YYYY", options: [{ label: "MM/DD/YYYY", value: "MM/DD/YYYY" }, { label: "YYYY-MM-DD", value: "YYYY-MM-DD" }, { label: "DD/MM/YYYY", value: "DD/MM/YYYY" }] },
      { key: "numberFormat", label: "Number format", type: "select", default: "US", options: [{ label: "US  1,234.56", value: "US" }, { label: "EU  1.234,56", value: "EU" }] },
      { key: "autoRefresh", label: "Auto-refresh data", description: "Automatically reload market data in the background", type: "toggle", default: true },
      { key: "autoRefreshInterval", label: "Refresh interval", description: "How often to reload market data", type: "select", default: 60, options: [{ label: "30 seconds", value: 30 }, { label: "1 minute", value: 60 }, { label: "2 minutes", value: 120 }, { label: "5 minutes", value: 300 }] },
      { key: "dashboardRefreshInterval", label: "Dashboard refresh", description: "How often the dashboard reloads independently of the global interval", type: "select", default: 60, options: [{ label: "30 seconds", value: 30 }, { label: "1 minute", value: 60 }, { label: "2 minutes", value: 120 }, { label: "5 minutes", value: 300 }] },
    ],
  },
  {
    id: "display",
    label: "Display & UI",
    icon: <Palette size={14} />,
    description: "Theme, screener table layout, and display preferences.",
    settings: [
      { key: "theme", label: "Theme", type: "select", default: "dark", options: [{ label: "Dark", value: "dark" }, { label: "Light", value: "light" }, { label: "System", value: "system" }] },
      { key: "screenerColumnVisibility", label: "Screener column visibility", description: "Choose which columns are visible in screener tables and symbol lists.", type: "toggleGroup", default: {
        symbol: true, price: true, changePercent: true, volume: true, relVol: true,
        marketCap: true, sector: true, beta: true, recommendedOutlook: true, opportunityScore: true,
      }, options: [
        { label: "Symbol", value: "symbol" },
        { label: "Price", value: "price" },
        { label: "Change %", value: "changePercent" },
        { label: "Volume", value: "volume" },
        { label: "Rel Vol", value: "relVol" },
        { label: "Market Cap", value: "marketCap" },
        { label: "Sector", value: "sector" },
        { label: "Beta", value: "beta" },
        { label: "Outlook", value: "recommendedOutlook" },
        { label: "Score", value: "opportunityScore" },
      ] },
      { key: "screenerRowsPerPage", label: "Rows per page", description: "Maximum screener rows shown at once", type: "select", default: 100, options: [{ label: "25", value: 25 }, { label: "50", value: 50 }, { label: "100", value: 100 }] },
      { key: "uiDensity", label: "Row density", description: "Adjusts padding in screener rows", type: "select", default: "comfortable", options: [{ label: "Compact", value: "compact" }, { label: "Comfortable", value: "comfortable" }] },
      { key: "showSectorBadge", label: "Show sector badges", description: "Display sector badges in screener lists where available", type: "toggle", default: true },
      { key: "showOutlookBadge", label: "Show outlook badges", description: "Display bullish, bearish, and neutral outlook badges", type: "toggle", default: true },
      { key: "showConvictionBadges", label: "Show conviction badges", description: "Display strategy and high-conviction badges", type: "toggle", default: true },
    ],
  },
  {
    id: "data",
    label: "Data & Universe",
    icon: <Database size={14} />,
    description: "Define the stock universe and control how market data is fetched and cached.",
    settings: [
      { key: "marketDataSource", label: "Market data source", type: "select", default: "auto", options: [{ label: "Auto (prefer Tastytrade)", value: "auto" }, { label: "Polygon only", value: "polygon" }, { label: "Tastytrade only", value: "tastytrade" }] },
      { key: "polygonRefreshRate", label: "Polygon refresh rate", type: "select", default: 30, options: [{ label: "15 seconds", value: 15 }, { label: "30 seconds", value: 30 }, { label: "1 minute", value: 60 }, { label: "2 minutes", value: 120 }] },
      { key: "screenerUniverseSize", label: "Screener universe", description: "Number of stocks scanned per cycle", type: "select", default: 1000, options: [{ label: "500 stocks", value: 500 }, { label: "1,000 stocks", value: 1000 }, { label: "2,500 stocks", value: 2500 }, { label: "5,000 stocks", value: 5000 }] },
      { key: "includeETFs", label: "Include ETFs", description: "Include exchange-traded funds in the screened universe", type: "toggle", default: true },
      { key: "includeIndices", label: "Include indices", description: "Include index trackers (SPY, QQQ, etc.)", type: "toggle", default: false },
      { key: "enablePreMarket", label: "Include pre-market data", description: "Show pre-market quotes where available", type: "toggle", default: false },
      { key: "enableAfterHours", label: "Include after-hours data", description: "Show after-hours quotes where available", type: "toggle", default: false },
      { key: "cacheStrategy", label: "Cache strategy", description: "How aggressively to cache API responses", type: "select", default: "moderate", options: [{ label: "Aggressive (longer TTL)", value: "aggressive" }, { label: "Moderate", value: "moderate" }, { label: "Minimal (always fresh)", value: "minimal" }] },
    ],
  },
  {
    id: "screener",
    label: "Screener & Scoring",
    icon: <Search size={14} />,
    description: "Default filter values and scoring thresholds when the Screener loads.",
    settings: [
      { key: "defaultMinIvRank", label: "Min IV rank", description: "Default lower bound for IV rank filter", type: "slider", default: 30, min: 0, max: 100, unit: "%" },
      { key: "defaultMinVolume", label: "Min daily volume", description: "Minimum share volume to include", type: "number", default: 500000, min: 0, unit: "shares" },
      { key: "defaultMinMarketCap", label: "Min market cap", type: "select", default: "1B", options: [{ label: "Any", value: "any" }, { label: "$300M+", value: "300M" }, { label: "$1B+", value: "1B" }, { label: "$10B+", value: "10B" }, { label: "$100B+", value: "100B" }] },
      { key: "defaultMinOpportunityScore", label: "Min opportunity score", description: "Only show stocks above this composite score", type: "slider", default: 50, min: 0, max: 100 },
      { key: "minPrice", label: "Min stock price", type: "number", default: 5, min: 0, unit: "$" },
      { key: "maxPrice", label: "Max stock price", description: "0 = no limit", type: "number", default: 0, min: 0, unit: "$" },
      { key: "minLiquidity", label: "Min liquidity", type: "select", default: "medium", options: [{ label: "Any", value: "any" }, { label: "Low", value: "low" }, { label: "Medium", value: "medium" }, { label: "High", value: "high" }] },
      { key: "screenerRowsPerPage", label: "Rows per page", description: "Maximum rows displayed in the screener table", type: "select", default: 100, options: [{ label: "25", value: 25 }, { label: "50", value: 50 }, { label: "100", value: 100 }] },
      { key: "screenerDefaultTab", label: "Default column view", description: "Which tab opens when you navigate to the screener", type: "select", default: "overview", options: [{ label: "Overview", value: "overview" }, { label: "Performance", value: "performance" }, { label: "Technicals", value: "technicals" }, { label: "Fundamentals", value: "fundamentals" }, { label: "Options", value: "options" }, { label: "Factor Alpha", value: "factors" }] },
      { key: "showSectorBadge", label: "Show sector column", description: "Display sector label in Overview tab", type: "toggle", default: true },
      { key: "showOutlookBadge", label: "Show outlook badge", description: "Display bullish/bearish badge in Overview and Options tabs", type: "toggle", default: true },
    ],
  },
  {
    id: "strategy",
    label: "Strategy Preferences",
    icon: <Target size={14} />,
    description: "Preferred strategies and default scoring parameters for recommendations.",
    settings: [
      { key: "preferredStrategies", label: "Preferred strategies", description: "Highlighted in strategy recommendations", type: "multiselect", default: ["Short Put", "Iron Condor"], options: [{ label: "Short Put", value: "Short Put" }, { label: "Iron Condor", value: "Iron Condor" }, { label: "Covered Call", value: "Covered Call" }, { label: "Short Strangle", value: "Short Strangle" }, { label: "Calendar Spread", value: "Calendar Spread" }, { label: "Diagonal Spread", value: "Diagonal Spread" }, { label: "Bull Put Spread", value: "Bull Put Spread" }, { label: "Bear Call Spread", value: "Bear Call Spread" }] },
      { key: "minCredit", label: "Min premium credit", description: "Minimum credit received to surface a strategy", type: "number", default: 0.5, min: 0, step: 0.05, unit: "$" },
      { key: "targetProfitPct", label: "Target profit %", description: "Default take-profit as % of max credit", type: "slider", default: 50, min: 10, max: 90, unit: "%" },
      { key: "maxLossMultiplier", label: "Max loss multiplier", description: "Stop-loss as multiple of premium received", type: "number", default: 2, min: 1, max: 5, step: 0.5 },
      { key: "showProbabilityOfProfit", label: "Show probability of profit", type: "toggle", default: true },
      { key: "useTheoreticalValue", label: "Use theoretical value", description: "Price strategies using model value vs mark", type: "toggle", default: false },
    ],
  },
  {
    id: "risk",
    label: "Risk Management",
    icon: <ShieldAlert size={14} />,
    description: "Position sizing limits and loss thresholds. Advisory — no orders are blocked.",
    settings: [
      { key: "maxPositionPct", label: "Max position size", description: "Largest single position as % of account value", type: "slider", default: 5, min: 1, max: 25, unit: "%" },
      { key: "maxPortfolioRisk", label: "Max portfolio risk", description: "Max % of account at risk across all open positions", type: "slider", default: 20, min: 1, max: 50, unit: "%" },
      { key: "maxSingleLoss", label: "Max single trade loss", description: "Dollar threshold before flagging a position", type: "number", default: 500, min: 0, unit: "$" },
      { key: "stopLossPct", label: "Stop-loss trigger", description: "Alert when a position reaches this % loss", type: "slider", default: 50, min: 10, max: 100, unit: "%" },
      { key: "marginBuffer", label: "Margin buffer", description: "Keep at least this % of buying power unused", type: "slider", default: 20, min: 0, max: 50, unit: "%" },
      { key: "maxOpenPositions", label: "Max open positions", description: "Alert when this count is exceeded", type: "number", default: 10, min: 1, max: 50 },
      { key: "enforceRiskLimits", label: "Show risk warnings", description: "Display warnings when limits would be exceeded", type: "toggle", default: true },
    ],
  },
  {
    id: "timeHorizon",
    label: "Time Horizon",
    icon: <Clock size={14} />,
    description: "Default DTE targets and time-based filters applied across the options chain and screener.",
    settings: [
      { key: "defaultDTE", label: "Default DTE", description: "Target days to expiration when browsing chains", type: "number", default: 45, min: 1, max: 365, unit: "days" },
      { key: "minDTE", label: "Minimum DTE", description: "Filter out expirations closer than this", type: "number", default: 7, min: 0, max: 60, unit: "days" },
      { key: "maxDTE", label: "Maximum DTE", description: "Filter out expirations farther than this", type: "number", default: 90, min: 1, max: 365, unit: "days" },
      { key: "defaultChartPeriod", label: "Default chart period", description: "Time range shown when opening a chart", type: "select", default: "1M", options: [{ label: "1 Day", value: "1D" }, { label: "1 Week", value: "1W" }, { label: "1 Month", value: "1M" }, { label: "3 Months", value: "3M" }, { label: "1 Year", value: "1Y" }] },
      { key: "expiryWarningDays", label: "Expiry warning", description: "Alert when a position is within this many days of expiry", type: "number", default: 7, min: 1, max: 30, unit: "days" },
      { key: "earningsBlackoutDays", label: "Earnings blackout", description: "Flag new positions with earnings within this many days", type: "number", default: 3, min: 0, max: 14, unit: "days" },
    ],
  },
  {
    id: "chartAnalysis",
    label: "Chart & Analysis",
    icon: <TrendingUp size={14} />,
    description: "Default chart style, indicators, and technical analysis display preferences.",
    settings: [
      { key: "chartStyle", label: "Chart style", type: "select", default: "line", options: [{ label: "Line", value: "line" }, { label: "Area", value: "area" }, { label: "Candlestick", value: "candlestick" }] },
      { key: "candleInterval", label: "Default candle interval", type: "select", default: "1D", options: [{ label: "1 minute", value: "1m" }, { label: "5 minutes", value: "5m" }, { label: "15 minutes", value: "15m" }, { label: "1 hour", value: "1H" }, { label: "1 day", value: "1D" }] },
      { key: "defaultChartIndicators", label: "Default indicators", description: "Indicators pre-loaded when opening a chart", type: "multiselect", default: ["SMA20", "SMA50"], options: [{ label: "SMA 20", value: "SMA20" }, { label: "SMA 50", value: "SMA50" }, { label: "SMA 200", value: "SMA200" }, { label: "EMA 20", value: "EMA20" }, { label: "VWAP", value: "VWAP" }, { label: "Bollinger Bands", value: "BB" }, { label: "RSI", value: "RSI" }, { label: "MACD", value: "MACD" }] },
      { key: "showVolumeOnChart", label: "Show volume bars", description: "Display volume histogram below the price chart", type: "toggle", default: true },
      { key: "rsiOverbought", label: "RSI overbought line", description: "Red dashed threshold on the RSI panel", type: "slider", default: 70, min: 60, max: 85 },
      { key: "rsiOversold", label: "RSI oversold line", description: "Green dashed threshold on the RSI panel", type: "slider", default: 30, min: 15, max: 40 },
    ],
  },
  {
    id: "pnl",
    label: "P&L & Simulation",
    icon: <BarChart2 size={14} />,
    description: "How positions are valued, performance is calculated, and P&L is reported.",
    settings: [
      { key: "pnlMethod", label: "P&L calculation method", type: "select", default: "mark", options: [{ label: "Mark price", value: "mark" }, { label: "Last price", value: "last" }, { label: "Theoretical value", value: "theoretical" }] },
      { key: "benchmark", label: "Performance benchmark", type: "select", default: "SPY", options: [{ label: "None", value: "none" }, { label: "SPY", value: "SPY" }, { label: "QQQ", value: "QQQ" }, { label: "IWM", value: "IWM" }, { label: "DIA", value: "DIA" }] },
      { key: "showUnrealizedPnl", label: "Show unrealized P&L", type: "toggle", default: true },
      { key: "showRealizedPnl", label: "Show realized P&L", type: "toggle", default: true },
      { key: "taxMethod", label: "Tax lot method", type: "select", default: "FIFO", options: [{ label: "FIFO", value: "FIFO" }, { label: "LIFO", value: "LIFO" }, { label: "Specific lot", value: "SpecificLot" }] },
    ],
  },
  {
    id: "greeks",
    label: "Greeks & Options Display",
    icon: <SlidersHorizontal size={14} />,
    description: "Options chain display, greek filters, and default order-entry parameters.",
    settings: [
      { key: "showGreeks", label: "Show Greeks columns", description: "Display Δ Γ Θ Vega in the options chain", type: "toggle", default: true },
      { key: "defaultMinDelta", label: "Min delta filter", description: "Lower delta bound for contract filter", type: "number", default: 0.1, min: 0, max: 1, step: 0.01 },
      { key: "defaultMaxDelta", label: "Max delta filter", description: "Upper delta bound for contract filter", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: "maxBidAskSpread", label: "Max bid-ask spread", description: "Filter out wide markets", type: "number", default: 0.5, min: 0, step: 0.05, unit: "$" },
      { key: "minOpenInterest", label: "Min open interest", description: "Filter out illiquid strikes", type: "number", default: 100, min: 0 },
      { key: "showWeeklyExp", label: "Show weekly expirations", type: "toggle", default: true },
      { key: "chainStrikeRange", label: "Strikes around ATM", description: "How many strikes above/below ATM to show", type: "number", default: 10, min: 3, max: 30 },
      { key: "highlightITM", label: "Highlight in-the-money strikes", type: "toggle", default: true },
      { key: "defaultContracts", label: "Default contracts", description: "Number of contracts pre-filled on order entry", type: "number", default: 1, min: 1, max: 100 },
      { key: "defaultOrderType", label: "Default order type", type: "select", default: "limit", options: [{ label: "Limit", value: "limit" }, { label: "Market", value: "market" }, { label: "Midpoint", value: "midpoint" }] },
      { key: "slippageTolerance", label: "Slippage tolerance", description: "Max cents from midpoint before alerting", type: "number", default: 5, min: 0, max: 50, unit: "¢" },
      { key: "confirmOrders", label: "Confirm before submitting", description: "Show a review screen before placing orders", type: "toggle", default: true },
      { key: "preferEvenLots", label: "Prefer even lot sizes", description: "Suggest quantities in multiples of 10", type: "toggle", default: false },
    ],
  },
  {
    id: "watchlist",
    label: "Watchlist",
    icon: <Bookmark size={14} />,
    description: "Default sort order, display columns, and alert thresholds for the watchlist.",
    settings: [
      { key: "watchlistDefaultSort", label: "Default sort", type: "select", default: "symbol", options: [{ label: "Symbol (A–Z)", value: "symbol" }, { label: "IV Rank (high–low)", value: "ivRankDesc" }, { label: "Daily change %", value: "changePctDesc" }, { label: "Added date", value: "addedDate" }] },
      { key: "watchlistShowIVRank", label: "Show IV Rank column", type: "toggle", default: true },
      { key: "watchlistShowEarnings", label: "Show earnings date", type: "toggle", default: true },
      { key: "watchlistShowDailyChange", label: "Show daily change", type: "toggle", default: true },
      { key: "ivRankAlertThreshold", label: "IV rank alert threshold", description: "Notify when a watchlist stock's IV rank crosses this level", type: "slider", default: 60, min: 0, max: 100, unit: "%" },
      { key: "priceMoveAlertPct", label: "Price move alert", description: "Notify on intraday move beyond this percentage", type: "slider", default: 5, min: 1, max: 20, unit: "%" },
      { key: "earningsAlertDays", label: "Earnings alert window", description: "Alert when a watchlist stock has earnings within this window", type: "number", default: 5, min: 1, max: 14, unit: "days" },
    ],
  },
  {
    id: "positions",
    label: "Positions",
    icon: <Briefcase size={14} />,
    description: "How your open positions are grouped, sorted, and displayed.",
    settings: [
      { key: "positionsGroupBy", label: "Group positions by", type: "select", default: "none", options: [{ label: "None (flat list)", value: "none" }, { label: "Symbol", value: "symbol" }, { label: "Strategy", value: "strategy" }, { label: "Expiry", value: "expiry" }] },
      { key: "positionsDefaultSort", label: "Default sort", type: "select", default: "openDate", options: [{ label: "Open date (newest)", value: "openDate" }, { label: "P&L ($)", value: "pnlAbs" }, { label: "P&L (%)", value: "pnlPct" }, { label: "DTE (soonest)", value: "dte" }, { label: "Symbol", value: "symbol" }] },
      { key: "showPortfolioDelta", label: "Show portfolio delta", description: "Display total portfolio Δ in the positions header", type: "toggle", default: true },
      { key: "showPortfolioTheta", label: "Show portfolio theta / day", description: "Display total portfolio Θ in the positions header", type: "toggle", default: true },
      { key: "autoCloseAtExpiry", label: "Auto-close at expiry warning", description: "Surface a reminder to close positions within 1 DTE", type: "toggle", default: false },
      { key: "pnlAlertThreshold", label: "Daily P&L alert", description: "Alert when daily P&L exceeds this amount (absolute)", type: "number", default: 1000, min: 0, unit: "$" },
    ],
  },
  {
    id: "security",
    label: "Security & Account",
    icon: <Lock size={14} />,
    description: "Notification delivery, connected account settings, and maintenance utilities.",
    settings: [
      { key: "browserNotifications", label: "Browser notifications", description: "Show OS-level push notifications", type: "toggle", default: false },
      { key: "soundAlerts", label: "Sound alerts", description: "Play a tone when important alerts fire", type: "toggle", default: false },
      { key: "toastDuration", label: "Toast duration", description: "How long in-app notifications stay on screen", type: "select", default: 3000, options: [{ label: "2 seconds", value: 2000 }, { label: "3 seconds", value: 3000 }, { label: "5 seconds", value: 5000 }, { label: "8 seconds", value: 8000 }] },
      { key: "debugMode", label: "Debug mode", description: "Log API calls and render cycles to the browser console", type: "toggle", default: false },
      { key: "apiTimeout", label: "API request timeout", description: "Abort requests that take longer than this", type: "number", default: 15000, min: 5000, max: 60000, step: 1000, unit: "ms" },
      { key: "logLevel", label: "Log level", type: "select", default: "warn", options: [{ label: "Error only", value: "error" }, { label: "Warnings", value: "warn" }, { label: "Info", value: "info" }, { label: "Debug (verbose)", value: "debug" }] },
      { key: "disableStreamer", label: "Disable live streamer", description: "Fall back to REST polling instead of DXLink WebSocket", type: "toggle", default: false },
    ],
  },
];

// ── Control components ─────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 38, height: 22, borderRadius: 11, border: "none", flexShrink: 0,
        background: checked ? "hsl(var(--primary))" : "rgba(255,255,255,0.1)",
        cursor: "pointer", position: "relative", transition: "background 0.15s",
      }}
      aria-pressed={checked}
    >
      <span style={{
        position: "absolute", top: 3,
        left: checked ? 19 : 3,
        width: 16, height: 16, borderRadius: "50%",
        background: "white", transition: "left 0.15s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
      }} />
    </button>
  );
}

function StyledSelect({ value, options, onChange }: { value: string | number; options: SelectOption[]; onChange: (v: string | number) => void }) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <select
        value={String(value)}
        onChange={e => {
          const opt = options.find(o => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        style={{
          appearance: "none", WebkitAppearance: "none",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, color: "hsl(var(--foreground))",
          fontSize: 12, fontWeight: 500,
          padding: "5px 28px 5px 10px",
          cursor: "pointer", outline: "none",
          minWidth: 150,
        }}
      >
        {options.map(o => (
          <option key={String(o.value)} value={String(o.value)} style={{ background: "hsl(0 0% 10%)" }}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={11} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "hsl(var(--muted-foreground))" }} />
    </div>
  );
}

function NumberInput({ value, min, max, step = 1, unit, onChange }: { value: number; min?: number; max?: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{
          width: 88, background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, color: "hsl(var(--foreground))",
          fontSize: 12, fontWeight: 500, padding: "5px 10px",
          outline: "none", textAlign: "right",
        }}
      />
      {unit && <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>{unit}</span>}
    </div>
  );
}

function SliderInput({ value, min, max, step = 1, unit, onChange }: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, minWidth: 180 }}>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "hsl(var(--primary))", cursor: "pointer" }}
      />
      <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", minWidth: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {value}{unit}
      </span>
    </div>
  );
}

function MultiSelectInput({ value, options, onChange }: { value: string[]; options: SelectOption[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxWidth: 320 }}>
      {options.map(o => {
        const active = value.includes(String(o.value));
        return (
          <button
            key={String(o.value)}
            onClick={() => {
              const sv = String(o.value);
              onChange(active ? value.filter(x => x !== sv) : [...value, sv]);
            }}
            style={{
              fontSize: 11, fontWeight: 500,
              padding: "3px 9px", borderRadius: 5,
              border: active ? "1px solid hsl(var(--primary)/0.5)" : "1px solid rgba(255,255,255,0.1)",
              background: active ? "hsl(var(--primary)/0.12)" : "rgba(255,255,255,0.04)",
              color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
              cursor: "pointer", transition: "all 0.1s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleGroupInput({
  value,
  defaults,
  options,
  onChange,
}: {
  value: Record<string, boolean> | undefined;
  defaults: Record<string, boolean>;
  options: SelectOption[];
  onChange: (v: Record<string, boolean>) => void;
}) {
  const current = { ...defaults, ...(value ?? {}) };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(120px, 1fr))", gap: 7, width: 300, maxWidth: "100%" }}>
      {options.map(o => {
        const key = String(o.value);
        const active = current[key] ?? true;
        return (
          <button
            key={key}
            onClick={() => onChange({ ...current, [key]: !active })}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              padding: "7px 9px", borderRadius: 6,
              border: active ? "1px solid hsl(var(--primary)/0.35)" : "1px solid rgba(255,255,255,0.08)",
              background: active ? "hsl(var(--primary)/0.10)" : "rgba(255,255,255,0.03)",
              color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              cursor: "pointer", fontSize: 11.5, fontWeight: 500,
            }}
          >
            <span>{o.label}</span>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: active ? "hsl(var(--primary))" : "rgba(255,255,255,0.16)",
              flexShrink: 0,
            }} />
          </button>
        );
      })}
    </div>
  );
}

// ── Setting row ────────────────────────────────────────────────────────────

function SettingRow({
  setting,
  value,
  onChange,
}: {
  setting: SettingDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  if (setting.type === "info") {
    return (
      <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{setting.label}</div>
        {setting.description && <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>{setting.description}</div>}
      </div>
    );
  }

  const control = (() => {
    switch (setting.type) {
      case "toggle":
        return <Toggle checked={Boolean(value ?? setting.default)} onChange={v => onChange(setting.key, v)} />;
      case "select":
        return <StyledSelect value={(value ?? setting.default) as string | number} options={setting.options} onChange={v => onChange(setting.key, v)} />;
      case "number":
        return <NumberInput value={Number(value ?? setting.default)} min={setting.min} max={setting.max} step={setting.step} unit={setting.unit} onChange={v => onChange(setting.key, v)} />;
      case "slider":
        return <SliderInput value={Number(value ?? setting.default)} min={setting.min} max={setting.max} step={setting.step} unit={setting.unit} onChange={v => onChange(setting.key, v)} />;
      case "multiselect":
        return <MultiSelectInput value={(value as string[] | undefined) ?? setting.default} options={setting.options} onChange={v => onChange(setting.key, v)} />;
      case "toggleGroup":
        return <ToggleGroupInput value={value as Record<string, boolean> | undefined} defaults={setting.default} options={setting.options} onChange={v => onChange(setting.key, v)} />;
    }
  })();

  const isMultiSelect = setting.type === "multiselect" || setting.type === "toggleGroup";

  return (
    <div style={{
      display: "flex", alignItems: isMultiSelect ? "flex-start" : "center",
      justifyContent: "space-between", gap: 24,
      padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{setting.label}</div>
        {setting.description && (
          <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3, lineHeight: 1.45 }}>
            {setting.description}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

// ── Save indicator ─────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const color = status === "error" ? "hsl(var(--destructive))" : status === "saved" ? "hsl(var(--success))" : "hsl(var(--muted-foreground))";
  const label = status === "saving" ? "Saving..." : status === "saved" ? "Saved ✓" : "Error saving";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, color, fontSize: 12, fontWeight: 500 }}>
      {status === "saving" ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={12} />}
      {label}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const isMobile = useIsMobile();
  const [activeCategory, setActiveCategory] = useState("general");
  const queryClient = useQueryClient();

  const { settings, isLoading, saveStatus, updateSetting, resetSettings } = useSettings();

  const handleChange = useCallback((key: string, value: unknown) => {
    updateSetting(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
  }, [updateSetting]);

  const handleResetToDefaults = useCallback(() => {
    if (!confirm("Reset all settings to their defaults? This cannot be undone.")) return;
    resetSettings();
  }, [resetSettings]);

  const handleExportSettings = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "optionsos-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [settings]);

  const handleClearQueryCache = useCallback(() => {
    queryClient.clear();
  }, [queryClient]);

  const activeCategoryDef = CATEGORIES.find(c => c.id === activeCategory)!;

  return (
    <div style={{ display: "flex", height: "100%", background: "hsl(0 0% 4%)", overflow: "hidden" }}>

      {/* ── Left sidebar ── */}
      {!isMobile && (
        <div style={{
          width: 220, flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column",
          background: "rgba(0,0,0,0.3)",
        }}>
          <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em", color: "hsl(var(--foreground))" }}>Settings</div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Changes save automatically</div>
          </div>
          <ScrollArea style={{ flex: 1 }}>
            <nav style={{ padding: "8px 8px" }}>
              {CATEGORIES.map(cat => {
                const active = cat.id === activeCategory;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 6, border: "none",
                      background: active ? "rgba(255,255,255,0.08)" : "transparent",
                      color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                      fontSize: 12.5, fontWeight: active ? 600 : 400,
                      cursor: "pointer", textAlign: "left",
                      transition: "all 0.1s",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    <span style={{ color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", flexShrink: 0 }}>
                      {cat.icon}
                    </span>
                    {cat.label}
                  </button>
                );
              })}
            </nav>
          </ScrollArea>
        </div>
      )}

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Content header */}
        <div style={{
          padding: isMobile ? "16px 16px 14px" : "22px 32px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
          flexShrink: 0,
        }}>
          <div>
            {/* Mobile: category selector */}
            {isMobile && (
              <div style={{ marginBottom: 12 }}>
                <StyledSelect
                  value={activeCategory}
                  options={CATEGORIES.map(c => ({ label: c.label, value: c.id }))}
                  onChange={v => setActiveCategory(String(v))}
                />
              </div>
            )}
            <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 700, letterSpacing: "-0.03em" }}>
              {activeCategoryDef.label}
            </div>
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4, lineHeight: 1.5 }}>
              {activeCategoryDef.description}
            </div>
          </div>
          <div style={{ flexShrink: 0, paddingTop: isMobile ? 0 : 2 }}>
            <SaveIndicator status={isLoading ? "saving" : saveStatus} />
          </div>
        </div>

        {/* Settings list */}
        <ScrollArea style={{ flex: 1 }}>
          <div style={{ padding: isMobile ? "0 16px 40px" : "0 32px 60px", maxWidth: 720 }}>

            {/* Security & Account — settings + action buttons */}
            {activeCategory === "security" && (
              <div style={{ paddingTop: 8 }}>
                {activeCategoryDef.settings.map(s => (
                  <SettingRow key={s.key} setting={s} value={settings[s.key as keyof AppSettings]} onChange={handleChange} />
                ))}

                <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>MAINTENANCE</div>

                  <ActionRow
                    label="Clear query cache"
                    description="Force all data to reload on next page visit"
                    icon={<RotateCcw size={13} />}
                    onClick={handleClearQueryCache}
                  />
                  <ActionRow
                    label="Export settings"
                    description="Download your settings as a JSON file"
                    icon={<Download size={13} />}
                    onClick={handleExportSettings}
                  />
                  <ActionRow
                    label="Reset to defaults"
                    description="Erase all saved settings and restore factory defaults"
                    icon={<RotateCcw size={13} />}
                    onClick={handleResetToDefaults}
                    variant="danger"
                  />
                </div>
              </div>
            )}

            {/* All other categories */}
            {activeCategory !== "security" && (
              <div style={{ paddingTop: 8 }}>
                {activeCategoryDef.settings.map(s => (
                  <SettingRow key={s.key} setting={s} value={settings[s.key as keyof AppSettings]} onChange={handleChange} />
                ))}
                {activeCategoryDef.settings.length === 0 && (
                  <div style={{ padding: "32px 0", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                    No settings in this category yet.
                  </div>
                )}
              </div>
            )}

          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function ActionRow({
  label,
  description,
  icon,
  onClick,
  variant = "default",
}: {
  label: string;
  description?: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  const isDanger = variant === "danger";
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "13px 14px", borderRadius: 8,
      border: `1px solid ${isDanger ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.07)"}`,
      background: isDanger ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.02)",
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: isDanger ? "hsl(var(--destructive))" : "hsl(var(--foreground))" }}>{label}</div>
        {description && <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{description}</div>}
      </div>
      <button
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 14px", borderRadius: 6, border: "none",
          background: isDanger ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)",
          color: isDanger ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
          fontSize: 12, fontWeight: 500, cursor: "pointer",
          transition: "background 0.12s",
        }}
      >
        {icon}
        {label}
      </button>
    </div>
  );
}
