import { useState, useCallback, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/contexts/SettingsContext";
import { SETTING_DEFAULTS, type AppSettings } from "@/lib/settings-defaults";
import {
  Settings, SlidersHorizontal, ShieldAlert, Search,
  Target, BarChart2, Palette, Database, Check,
  Loader2, RotateCcw, Download, ChevronDown,
  Clock, TrendingUp, Bookmark, Briefcase, Lock,
  Eye, EyeOff, PlugZap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type SelectOption = { label: string; value: string | number };

type SettingDef =
  | { key: string; label: string; description?: string; type: "toggle"; default: boolean }
  | { key: string; label: string; description?: string; type: "select"; default: string | number; options: SelectOption[] }
  | { key: string; label: string; description?: string; type: "number"; default: number; min?: number; max?: number; step?: number; unit?: string }
  | { key: string; label: string; description?: string; type: "slider"; default: number; min: number; max: number; step?: number; unit?: string; showMaxInLabel?: boolean }
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

const SCREENER_SORT_FIELDS: SelectOption[] = [
  { label: "Symbol", value: "symbol" },
  { label: "Name", value: "name" },
  { label: "Price", value: "price" },
  { label: "Change", value: "change" },
  { label: "Change %", value: "changePercent" },
  { label: "Volume", value: "volume" },
  { label: "Average Volume", value: "avgVolume" },
  { label: "Relative Volume", value: "relVol" },
  { label: "Market Cap", value: "marketCap" },
  { label: "Sector", value: "sector" },
  { label: "Beta", value: "beta" },
  { label: "P/E", value: "pe" },
  { label: "Forward P/E", value: "forwardPE" },
  { label: "EPS", value: "eps" },
  { label: "Dividend Yield", value: "dividendYield" },
  { label: "Short Ratio", value: "shortRatio" },
  { label: "Price Target", value: "priceTarget" },
  { label: "Recommendation", value: "recommendation" },
  { label: "52W High", value: "fiftyTwoWeekHigh" },
  { label: "52W Low", value: "fiftyTwoWeekLow" },
  { label: "% From 52W High", value: "pctFrom52High" },
  { label: "% From 52W Low", value: "pctFrom52Low" },
  { label: "Earnings Date", value: "earningsDate" },
  { label: "Technical Strength", value: "technicalStrength" },
  { label: "RSI 14", value: "rsi14" },
  { label: "MACD Histogram", value: "macdHistogram" },
  { label: "IV Rank", value: "ivRank" },
  { label: "Opportunity Score", value: "opportunityScore" },
  { label: "Technical Score", value: "technicalScore" },
  { label: "IV Score", value: "ivScore" },
  { label: "Entry Score", value: "entryScore" },
  { label: "Momentum Score", value: "momentumScore" },
  { label: "VWAP Score", value: "vwapScore" },
  { label: "Setup Type", value: "setupType" },
  { label: "Outlook", value: "recommendedOutlook" },
  { label: "Support Price", value: "supportPrice" },
  { label: "Resistance Price", value: "resistancePrice" },
  { label: "Liquidity", value: "liquidity" },
  { label: "Source", value: "source" },
];

const SCREENER_PRESET_OPTIONS = [
  "All", "Options Seller", "Momentum", "High Volume", "Value", "Bullish Setup",
  "Short Squeeze", "Dividend", "High IV", "Low IV", "Oversold", "Overbought",
  "Earnings Soon", "Large Cap", "Small Cap",
].map(label => ({ label, value: label }));

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
      { key: "universeMode", label: "Universe mode", description: "Choose the screener source universe.", type: "select", default: "polygon", options: [{ label: "Polygon full (~4,800 stocks)", value: "polygon" }, { label: "Yahoo curated (~477 stocks)", value: "yahoo" }] },
      { key: "cacheRefreshInterval", label: "Cache refresh interval", description: "How long screener data stays fresh before background refresh.", type: "select", default: 30 * 60 * 1000, options: [{ label: "15 minutes", value: 15 * 60 * 1000 }, { label: "30 minutes", value: 30 * 60 * 1000 }, { label: "1 hour", value: 60 * 60 * 1000 }, { label: "2 hours", value: 2 * 60 * 60 * 1000 }] },
      { key: "showDataSourceTags", label: "Show data source tags", description: "Display Polygon, Yahoo, and EOD badges in screener rows.", type: "toggle", default: true },
    ],
  },
  {
    id: "screener",
    label: "Screener & Scoring",
    icon: <Search size={14} />,
    description: "Default filter values and scoring thresholds when the Screener loads.",
    settings: [
      { key: "minOpportunityScoreToShow", label: "Minimum opportunity score", description: "Hide screener rows below this composite score.", type: "slider", default: 0, min: 0, max: 100 },
      { key: "highConvictionOpportunityScore", label: "opportunityScore min", description: "Opportunity score required before a row can qualify as high conviction.", type: "slider", default: 75, min: 0, max: 100, showMaxInLabel: true },
      { key: "highConvictionTechnicalScore", label: "technicalScore min", type: "slider", default: 20, min: 0, max: 35, showMaxInLabel: true },
      { key: "highConvictionIvScore", label: "ivScore min", type: "slider", default: 15, min: 0, max: 25, showMaxInLabel: true },
      { key: "highConvictionEntryScore", label: "entryScore min", type: "slider", default: 15, min: 0, max: 25, showMaxInLabel: true },
      { key: "highConvictionMomentumScore", label: "momentumScore min", type: "slider", default: 8, min: 0, max: 15, showMaxInLabel: true },
      { key: "screenerDefaultSortColumn", label: "Default sort column", description: "Column used when the screener opens or defaults are reset.", type: "select", default: "marketCap", options: SCREENER_SORT_FIELDS },
      { key: "screenerDefaultSortDirection", label: "Default sort direction", type: "select", default: "desc", options: [{ label: "Ascending", value: "asc" }, { label: "Descending", value: "desc" }] },
      { key: "screenerDefaultPreset", label: "Default filter preset on load", type: "select", default: "All", options: SCREENER_PRESET_OPTIONS },
      { key: "screenerDefaultLiquidity", label: "Liquidity filter default", type: "select", default: "all", options: [{ label: "All", value: "all" }, { label: "Liquid only", value: "liquid" }] },
      { key: "screenerDefaultOutlook", label: "Default outlook filter", type: "select", default: "all", options: [{ label: "All", value: "all" }, { label: "Bullish", value: "bullish" }, { label: "Bearish", value: "bearish" }, { label: "Neutral", value: "neutral" }] },
      { key: "showScoreBreakdownTooltip", label: "Show score breakdown tooltip", description: "Expose component scores when hovering opportunity score cells.", type: "toggle", default: true },
      { key: "showSetupTypeBadge", label: "Show setup type badge", type: "toggle", default: true },
      { key: "showRecommendationBadge", label: "Show recommendation badge", type: "toggle", default: true },
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
  const label = setting.type === "slider" && setting.showMaxInLabel
    ? `${setting.label}: ${Number(value ?? setting.default)} / ${setting.max}`
    : setting.label;

  return (
    <div style={{
      display: "flex", alignItems: isMultiSelect ? "flex-start" : "center",
      justifyContent: "space-between", gap: 24,
      padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
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

type ServerEnvPayload = {
  polygonApiKey: { configured: boolean; masked: string };
  tastytrade: {
    status: "connected" | "disconnected" | "error";
    username: string;
    accountNumber: { configured: boolean; masked: string };
    clientId: { configured: boolean; masked: string };
    clientSecret: { configured: boolean; masked: string };
    redirectUri: string;
    refreshToken: { configured: boolean; masked: string };
    tokenExpiresAt: number | null;
  };
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed: ${response.status}`);
  return body as T;
}

function inputStyle() {
  return {
    flex: 1,
    minWidth: 0,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "hsl(var(--foreground))",
    fontSize: 12,
    padding: "7px 10px",
    outline: "none",
  } as const;
}

function smallButtonStyle() {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    background: "rgba(255,255,255,0.08)",
    color: "hsl(var(--foreground))",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  } as const;
}

function SecretField({ label, masked, value, placeholder, onChange }: {
  label: string;
  masked?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input type={revealed ? "text" : "password"} value={value} placeholder={placeholder ?? masked ?? ""} onChange={(event) => onChange(event.target.value)} style={inputStyle()} />
        <button type="button" onClick={() => setRevealed(current => !current)} title={revealed ? "Hide value" : "Reveal value"} style={{ width: 34, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "hsl(var(--muted-foreground))", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function TextField({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>{label}</div>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} style={inputStyle()} />
    </div>
  );
}

function DataUniversePanel({ settings, onChange }: { settings: AppSettings; onChange: (key: string, value: unknown) => void }) {
  const [serverEnv, setServerEnv] = useState<ServerEnvPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState("");
  const [flushStatus, setFlushStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [testStatus, setTestStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  const loadServerEnv = useCallback(() => {
    apiJson<ServerEnvPayload>("/api/settings/server-env").then(setServerEnv).catch(() => setServerEnv(null));
  }, []);

  useEffect(() => { loadServerEnv(); }, [loadServerEnv]);

  const updateDraft = (key: string, value: string) => setDrafts(current => ({ ...current, [key]: value }));

  const saveServerEnv = async () => {
    const patch = Object.fromEntries(Object.entries(drafts).filter(([, value]) => value.trim() !== ""));
    if (Object.keys(patch).length === 0) return;
    setSaveMessage("Saving...");
    try {
      const next = await apiJson<ServerEnvPayload>("/api/settings/server-env", { method: "PATCH", body: JSON.stringify(patch) });
      setServerEnv(next);
      setDrafts({});
      setSaveMessage("Saved ✓");
      setTimeout(() => setSaveMessage(""), 1800);
    } catch (err) {
      setSaveMessage((err as Error).message);
    }
  };

  const flushCache = async () => {
    setFlushStatus("saving");
    try {
      await apiJson<{ ok: boolean }>("/api/screener/flush", { method: "POST" });
      setFlushStatus("success");
      setTimeout(() => setFlushStatus("idle"), 2200);
    } catch {
      setFlushStatus("error");
    }
  };

  const testConnection = async () => {
    setTestStatus("saving");
    setTestMessage("");
    try {
      const result = await apiJson<{ message?: string }>("/api/tastytrade/test", { method: "POST" });
      setTestStatus("success");
      setTestMessage(result.message ?? "Tastytrade connection verified");
      loadServerEnv();
    } catch (err) {
      setTestStatus("error");
      setTestMessage((err as Error).message);
    }
  };

  const connected = serverEnv?.tastytrade.status === "connected";
  const expiry = serverEnv?.tastytrade.tokenExpiresAt;
  const tokenWarning = expiry != null && expiry - Date.now() < 7 * 24 * 60 * 60 * 1000;

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 22 }}>
      <div>
        {CATEGORIES.find(c => c.id === "data")!.settings.map(setting => (
          <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
        ))}
        <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <SecretField label="Polygon API key" masked={serverEnv?.polygonApiKey.masked} value={drafts.polygonApiKey ?? ""} placeholder={serverEnv?.polygonApiKey.configured ? serverEnv.polygonApiKey.masked : "Enter Polygon API key"} onChange={value => updateDraft("polygonApiKey", value)} />
        </div>
        <ActionRow label={flushStatus === "saving" ? "Clearing cache" : flushStatus === "success" ? "Cache cleared ✓" : "Flush Cache"} description="Clears in-memory screener data and the Postgres screener_cache table" icon={flushStatus === "saving" ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={13} />} onClick={flushCache} />
        {flushStatus === "error" && <div style={{ fontSize: 12, color: "hsl(var(--destructive))", marginTop: 8 }}>Cache flush failed.</div>}
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Tastytrade Integration</div>
            <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Credentials are stored server-side in artifacts/api-server/.env.</div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 9px", borderRadius: 999, color: connected ? "hsl(var(--success))" : "hsl(var(--destructive))", background: connected ? "hsl(var(--success) / 0.10)" : "hsl(var(--destructive) / 0.10)", border: `1px solid ${connected ? "hsl(var(--success) / 0.25)" : "hsl(var(--destructive) / 0.25)"}`, fontSize: 11, fontWeight: 700 }}>
            <PlugZap size={12} />
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <TextField label="Username" value={drafts.tastytradeUsername ?? serverEnv?.tastytrade.username ?? ""} onChange={value => updateDraft("tastytradeUsername", value)} placeholder="Optional display username" />
          <SecretField label="Account number" masked={serverEnv?.tastytrade.accountNumber.masked} value={drafts.tastytradeAccountNumber ?? ""} placeholder={serverEnv?.tastytrade.accountNumber.masked || "Account number"} onChange={value => updateDraft("tastytradeAccountNumber", value)} />
          <SecretField label="Client ID" masked={serverEnv?.tastytrade.clientId.masked} value={drafts.tastytradeClientId ?? ""} placeholder={serverEnv?.tastytrade.clientId.masked || "Client ID"} onChange={value => updateDraft("tastytradeClientId", value)} />
          <SecretField label="Client Secret" masked={serverEnv?.tastytrade.clientSecret.masked} value={drafts.tastytradeClientSecret ?? ""} placeholder={serverEnv?.tastytrade.clientSecret.masked || "Client secret"} onChange={value => updateDraft("tastytradeClientSecret", value)} />
          <TextField label="Redirect URI" value={drafts.tastytradeRedirectUri ?? serverEnv?.tastytrade.redirectUri ?? ""} onChange={value => updateDraft("tastytradeRedirectUri", value)} placeholder="http://localhost:3000/api/auth/tastytrade/callback" />
          <div>
            <SecretField label="Refresh Token" masked={serverEnv?.tastytrade.refreshToken.masked} value={drafts.tastytradeRefreshToken ?? ""} placeholder={serverEnv?.tastytrade.refreshToken.masked || "Refresh token"} onChange={value => updateDraft("tastytradeRefreshToken", value)} />
            {tokenWarning && <div style={{ marginTop: 6, color: "hsl(38 92% 50%)", fontSize: 11 }}>Refresh token or active session may expire soon.</div>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={saveServerEnv} style={smallButtonStyle()}>Save credentials</button>
          <button onClick={testConnection} style={smallButtonStyle()}>{testStatus === "saving" && <Loader2 size={13} style={{ animation: "spin 1s linear infinite", marginRight: 6 }} />}Test Connection</button>
          <button onClick={() => { window.location.href = "/api/auth/tastytrade"; }} style={smallButtonStyle()}>Reconnect</button>
          {saveMessage && <span style={{ fontSize: 12, color: saveMessage.includes("Saved") ? "hsl(var(--success))" : "hsl(var(--muted-foreground))" }}>{saveMessage}</span>}
          {testMessage && <span style={{ fontSize: 12, color: testStatus === "success" ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>{testMessage}</span>}
        </div>
      </div>
    </div>
  );
}

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

  const handleResetCategory = useCallback((category: CategoryDef) => {
    for (const setting of category.settings) {
      if (setting.type === "info") continue;
      const key = setting.key as keyof AppSettings;
      updateSetting(key, SETTING_DEFAULTS[key]);
    }
  }, [updateSetting]);

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
            {activeCategory === "data" && (
              <DataUniversePanel settings={settings} onChange={handleChange} />
            )}

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
            {activeCategory !== "security" && activeCategory !== "data" && (
              <div style={{ paddingTop: 8 }}>
                {activeCategoryDef.settings.map(s => (
                  <SettingRow key={s.key} setting={s} value={settings[s.key as keyof AppSettings]} onChange={handleChange} />
                ))}
                {activeCategoryDef.settings.length === 0 && (
                  <div style={{ padding: "32px 0", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                    No settings in this category yet.
                  </div>
                )}
                {activeCategory === "screener" && (
                  <div style={{ marginTop: 18 }}>
                    <ActionRow
                      label="Reset to Defaults"
                      description="Restore every Screener & Scoring option to its default value"
                      icon={<RotateCcw size={13} />}
                      onClick={() => handleResetCategory(activeCategoryDef)}
                    />
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
