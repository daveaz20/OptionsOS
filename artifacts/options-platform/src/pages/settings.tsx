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
  Eye, EyeOff, PlugZap, Trash2,
  Upload, HardDrive, AlertTriangle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type SelectOption = { label: string; value: string | number };

type SettingDef =
  | { key: string; label: string; description?: string; type: "toggle"; default: boolean }
  | { key: string; label: string; description?: string; type: "select"; default: string | number; options: SelectOption[] }
  | { key: string; label: string; description?: string; type: "time"; default: string }
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

const CHART_COLORS: SelectOption[] = [
  { label: "Blue",   value: "#60a5fa" },
  { label: "Yellow", value: "#f59e0b" },
  { label: "Purple", value: "#a78bfa" },
  { label: "Green",  value: "#22c55e" },
  { label: "Orange", value: "#f97316" },
  { label: "Teal",   value: "#14b8a6" },
  { label: "Red",    value: "#ef4444" },
  { label: "Pink",   value: "#ec4899" },
  { label: "Cyan",   value: "#06b6d4" },
  { label: "White",  value: "#e2e8f0" },
];

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
  { label: "Risk Score", value: "riskScore" },
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
      { key: "defaultPage", label: "Default page", description: "Page shown on launch", type: "select", default: "/", options: [{ label: "Dashboard", value: "/" }, { label: "Scans", value: "/scans" }, { label: "Analysis", value: "/analysis" }, { label: "Watchlist", value: "/watchlist" }, { label: "Positions", value: "/positions" }] },
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
    description: "Theme, Scans table layout, and display preferences.",
    settings: [
      { key: "theme", label: "Theme", type: "select", default: "dark", options: [{ label: "Dark", value: "dark" }, { label: "Light", value: "light" }, { label: "System", value: "system" }] },
      { key: "screenerColumnVisibility", label: "Scans column visibility", description: "Choose which columns are visible in Scans tables and symbol lists.", type: "toggleGroup", default: {
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
      { key: "screenerRowsPerPage", label: "Rows per page", description: "Maximum Scans rows shown at once", type: "select", default: 100, options: [{ label: "25", value: 25 }, { label: "50", value: 50 }, { label: "100", value: 100 }] },
      { key: "uiDensity", label: "Row density", description: "Adjusts padding in Scans rows", type: "select", default: "comfortable", options: [{ label: "Compact", value: "compact" }, { label: "Comfortable", value: "comfortable" }] },
      { key: "showSectorBadge", label: "Show sector badges", description: "Display sector badges in Scans lists where available", type: "toggle", default: true },
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
      { key: "universeMode", label: "Universe mode", description: "Choose the Scans source universe.", type: "select", default: "polygon", options: [{ label: "Polygon full (~4,800 stocks)", value: "polygon" }, { label: "Yahoo curated (~477 stocks)", value: "yahoo" }] },
      { key: "cacheRefreshInterval", label: "Cache refresh interval", description: "How long Scans data stays fresh before background refresh.", type: "select", default: 30 * 60 * 1000, options: [{ label: "15 minutes", value: 15 * 60 * 1000 }, { label: "30 minutes", value: 30 * 60 * 1000 }, { label: "1 hour", value: 60 * 60 * 1000 }, { label: "2 hours", value: 2 * 60 * 60 * 1000 }] },
      { key: "showDataSourceTags", label: "Show data source tags", description: "Display Polygon, Yahoo, and EOD badges in Scans rows.", type: "toggle", default: true },
    ],
  },
  {
    id: "screener",
    label: "Scans & Scoring",
    icon: <Search size={14} />,
    description: "Default filter values and scoring thresholds when Scans loads.",
    settings: [
      { key: "minOpportunityScoreToShow", label: "Minimum opportunity score", description: "Hide Scans rows below this composite score.", type: "slider", default: 0, min: 0, max: 100 },
      { key: "highConvictionOpportunityScore", label: "Composite min (/100)", description: "Opportunity score required before a row can qualify as high conviction.", type: "slider", default: 72, min: 0, max: 100, showMaxInLabel: true },
      { key: "highConvictionTechnicalScore",   label: "Technical min (/10)",  type: "slider", default: 6, min: 0, max: 10, showMaxInLabel: true },
      { key: "highConvictionIvScore",          label: "IV Regime min (/10)",  type: "slider", default: 6, min: 0, max: 10, showMaxInLabel: true },
      { key: "highConvictionEntryScore",       label: "Entry min (/10)",      type: "slider", default: 5, min: 0, max: 10, showMaxInLabel: true },
      { key: "highConvictionMomentumScore",    label: "Momentum min (/10)",   type: "slider", default: 5, min: 0, max: 10, showMaxInLabel: true },
      { key: "highConvictionRiskScore",        label: "Risk min (/10)",       description: "Minimum earnings-risk grade. Useful for avoiding entries near binary events.", type: "slider", default: 5, min: 0, max: 10, showMaxInLabel: true },
      { key: "screenerDefaultSortColumn", label: "Default sort column", description: "Column used when Scans opens or defaults are reset.", type: "select", default: "marketCap", options: SCREENER_SORT_FIELDS },
      { key: "screenerDefaultSortDirection", label: "Default sort direction", type: "select", default: "desc", options: [{ label: "Ascending", value: "asc" }, { label: "Descending", value: "desc" }] },
      { key: "screenerDefaultPreset", label: "Default filter preset on load", type: "select", default: "All", options: SCREENER_PRESET_OPTIONS },
      { key: "screenerDefaultLiquidity", label: "Liquidity filter default", type: "select", default: "all", options: [{ label: "All", value: "all" }, { label: "Liquid only", value: "liquid" }] },
      { key: "screenerDefaultOutlook", label: "Default outlook filter", type: "select", default: "all", options: [{ label: "All", value: "all" }, { label: "Bullish", value: "bullish" }, { label: "Bearish", value: "bearish" }, { label: "Neutral", value: "neutral" }] },
      { key: "screenerDefaultTab", label: "Default column tab on load", type: "select", default: "overview", options: [{ label: "Overview", value: "overview" }, { label: "Performance", value: "performance" }, { label: "Technicals", value: "technicals" }, { label: "Fundamentals", value: "fundamentals" }, { label: "Options", value: "options" }, { label: "Factor Alpha", value: "factors" }] },
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
      { key: "preferredIvEnvironment", label: "Preferred IV environment", type: "select", default: "any", options: [{ label: "Any", value: "any" }, { label: "High IV", value: "high" }, { label: "Low IV", value: "low" }] },
      { key: "ivRankLowThreshold", label: "IV Rank low threshold", type: "slider", default: 30, min: 0, max: 100 },
      { key: "ivRankHighThreshold", label: "IV Rank high threshold", type: "slider", default: 60, min: 0, max: 100 },
      { key: "strategyAutoSelectByIv", label: "Strategy auto-selection based on IV environment", type: "toggle", default: true },
      { key: "technicalScoreWeight", label: "Technical weight",  description: "Weight for MA stack + trend + MACD grade.",     type: "slider", default: 25, min: 0, max: 50 },
      { key: "ivScoreWeight",        label: "IV Regime weight",  description: "Weight for IV rank vs strategy fit.",            type: "slider", default: 25, min: 0, max: 50 },
      { key: "momentumScoreWeight",  label: "Momentum weight",   description: "Weight for volume confirmation + VWAP.",         type: "slider", default: 20, min: 0, max: 40 },
      { key: "entryScoreWeight",     label: "Entry weight",      description: "Weight for price position within S/R range.",    type: "slider", default: 15, min: 0, max: 35 },
      { key: "riskScoreWeight",      label: "Risk weight",       description: "Weight for earnings proximity safety grade.",    type: "slider", default: 15, min: 0, max: 35 },
    ],
  },
  {
    id: "risk",
    label: "Risk Management",
    icon: <ShieldAlert size={14} />,
    description: "Position sizing, loss limits, and options-specific risk controls.",
    settings: [
      { key: "maxPositionPct", label: "Max position size", description: "Largest single position as % of portfolio", type: "slider", default: 5, min: 1, max: 25, unit: "%" },
      { key: "maxCapitalPerTrade", label: "Max capital per trade", description: "Hard dollar cap before a strategy is flagged", type: "number", default: 2000, min: 0, step: 100, unit: "$" },
      { key: "maxTotalCapitalDeployedPct", label: "Max total capital deployed", description: "Maximum deployed capital as % of portfolio", type: "slider", default: 50, min: 10, max: 100, unit: "%" },
      { key: "maxSingleLoss", label: "Max loss per trade ($)", description: "Dollar threshold before flagging a position", type: "number", default: 500, min: 0, step: 50, unit: "$" },
      { key: "maxLossPerTradePct", label: "Max loss per trade (%)", description: "Maximum loss as % of position value", type: "slider", default: 25, min: 5, max: 50, unit: "%" },
      { key: "maxPortfolioDrawdownPct", label: "Max portfolio drawdown", description: "Portfolio drawdown threshold before warnings turn red", type: "slider", default: 10, min: 1, max: 25, unit: "%" },
      { key: "dailyLossLimit", label: "Daily loss limit", description: "Stop trading for the day if exceeded", type: "number", default: 1000, min: 0, step: 100, unit: "$" },
      { key: "maxOpenPositions", label: "Max open positions", description: "Alert when this count is exceeded", type: "slider", default: 10, min: 1, max: 50 },
      { key: "maxPositionsPerSector", label: "Max positions per sector", type: "slider", default: 3, min: 1, max: 10 },
      { key: "maxPositionsPerUnderlying", label: "Max positions per underlying", type: "slider", default: 1, min: 1, max: 5 },
      { key: "maxLosingPositions", label: "Max losing positions at once", type: "number", default: 5, min: 0, max: 50 },
      { key: "riskMinDTE", label: "Min days to expiration", description: "DTE floor for generated strategy recommendations", type: "number", default: 21, min: 0, max: 365, unit: "days" },
      { key: "riskMaxDTE", label: "Max days to expiration", description: "DTE ceiling for generated strategy recommendations", type: "number", default: 60, min: 1, max: 365, unit: "days" },
      { key: "earningsAvoidanceDays", label: "Avoid earnings window", description: "Avoid opening positions within this many days of earnings", type: "number", default: 5, min: 0, max: 30, unit: "days" },
      { key: "minOpenInterest", label: "Min open interest per contract", type: "number", default: 100, min: 0 },
      { key: "minContractVolume", label: "Min volume per contract", type: "number", default: 10, min: 0 },
      { key: "maxBidAskSpreadPct", label: "Max bid/ask spread", type: "slider", default: 10, min: 1, max: 100, unit: "%" },
      { key: "showRiskWarnings", label: "Show risk warnings", description: "Show yellow and red badges in the Strategy panel", type: "toggle", default: true },
      { key: "showPositionSizingSuggestion", label: "Show position sizing suggestion", description: "Display suggested position size based on portfolio value", type: "toggle", default: true },
      { key: "portfolioSize", label: "Portfolio size", description: "Used to calculate position sizing suggestions", type: "number", default: 50000, min: 0, step: 1000, unit: "$" },
    ],
  },
  {
    id: "timeHorizon",
    label: "Time Horizon",
    icon: <Clock size={14} />,
    description: "Default DTE targets and time-based filters applied across the options chain and Scans.",
    settings: [
      { key: "minDTE", label: "Default DTE minimum", description: "Overrides Risk Management DTE floor for strategy recommendations", type: "slider", default: 21, min: 0, max: 180, unit: "d" },
      { key: "maxDTE", label: "Default DTE maximum", description: "Overrides Risk Management DTE ceiling for strategy recommendations", type: "slider", default: 60, min: 7, max: 365, unit: "d" },
      { key: "showDteRangeFilterDefault", label: "Show DTE range filter in Scans by default", type: "toggle", default: true },
      { key: "preferredExpirationCycles", label: "Preferred expiration cycles", type: "multiselect", default: ["weekly", "monthly"], options: [{ label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" }, { label: "Quarterly", value: "quarterly" }, { label: "LEAPS", value: "leaps" }] },
      { key: "highlightPreferredExpirationCycles", label: "Highlight preferred cycles in options chain", type: "toggle", default: true },
      { key: "warnOutsidePreferredExpirationCycle", label: "Warn outside preferred cycle", type: "toggle", default: true },
      { key: "earningsAvoidanceBeforeDays", label: "Avoid before earnings", type: "slider", default: 5, min: 0, max: 21, unit: "d" },
      { key: "earningsAvoidanceAfterDays", label: "Avoid after earnings", type: "slider", default: 1, min: 0, max: 7, unit: "d" },
      { key: "showEarningsDateColumnDefault", label: "Show earnings date column in Scans by default", type: "toggle", default: true },
      { key: "showEarningsWarningBadge", label: "Show earnings warning badge in Scans", type: "toggle", default: true },
      { key: "allowEarningsAvoidanceOverride", label: "Allow earnings override with confirmation", type: "toggle", default: false },
      { key: "thetaOpenMinDTE", label: "Theta open zone minimum", type: "slider", default: 21, min: 0, max: 180, unit: "d" },
      { key: "thetaOpenMaxDTE", label: "Theta open zone maximum", type: "slider", default: 45, min: 7, max: 365, unit: "d" },
      { key: "thetaCloseProfitPct", label: "Theta close profit target", description: "Close when this % of max profit is reached", type: "slider", default: 50, min: 1, max: 100, unit: "%" },
      { key: "thetaCloseDTE", label: "Theta close DTE", description: "Close or roll when DTE reaches this value", type: "slider", default: 21, min: 0, max: 90, unit: "d" },
      { key: "showThetaDecayChart", label: "Show theta decay chart in StrategyPanel by default", type: "toggle", default: true },
      { key: "avoidMondayMorningEntries", label: "Avoid Monday morning entries", type: "toggle", default: false },
      { key: "avoidFridayAfternoonEntries", label: "Avoid Friday afternoon entries", type: "toggle", default: false },
      { key: "preferredTradingWindowStart", label: "Preferred trading window start", type: "time", default: "09:45" },
      { key: "preferredTradingWindowEnd", label: "Preferred trading window end", type: "time", default: "15:45" },
    ],
  },
  {
    id: "chartAnalysis",
    label: "Chart & Analysis",
    icon: <TrendingUp size={14} />,
    description: "Default chart style, indicators, and technical analysis display preferences.",
    settings: [
      { key: "defaultChartPeriod", label: "Default chart timeframe", type: "select", default: "1M", options: [{ label: "1D", value: "1D" }, { label: "1W", value: "1W" }, { label: "1M", value: "1M" }, { label: "3M", value: "3M" }, { label: "6M", value: "6M" }, { label: "1Y", value: "1Y" }, { label: "2Y", value: "2Y" }] },
      { key: "chartStyle", label: "Default chart type", type: "select", default: "candlestick", options: [{ label: "Candlestick", value: "candlestick" }, { label: "Line", value: "line" }, { label: "OHLC", value: "ohlc" }, { label: "Area", value: "area" }] },
      { key: "chartHeight", label: "Default chart height", type: "select", default: "normal", options: [{ label: "Compact", value: "compact" }, { label: "Normal", value: "normal" }, { label: "Expanded", value: "expanded" }] },
      { key: "autoFitChartToPrice", label: "Auto-fit chart to price range on load", type: "toggle", default: true },
      { key: "showSMA20", label: "Show SMA20", type: "toggle", default: true },
      { key: "sma20Color", label: "SMA20 color", type: "select", default: "#60a5fa", options: CHART_COLORS },
      { key: "showSMA50", label: "Show SMA50", type: "toggle", default: true },
      { key: "sma50Color", label: "SMA50 color", type: "select", default: "#f59e0b", options: CHART_COLORS },
      { key: "showSMA200", label: "Show SMA200", type: "toggle", default: true },
      { key: "sma200Color", label: "SMA200 color", type: "select", default: "#a78bfa", options: CHART_COLORS },
      { key: "showEMA9", label: "Show EMA9", type: "toggle", default: false },
      { key: "ema9Color", label: "EMA9 color", type: "select", default: "#22c55e", options: CHART_COLORS },
      { key: "showEMA21", label: "Show EMA21", type: "toggle", default: false },
      { key: "ema21Color", label: "EMA21 color", type: "select", default: "#f97316", options: CHART_COLORS },
      { key: "showVolumeOnChart", label: "Show volume bars", type: "toggle", default: true },
      { key: "showVWAPLine", label: "Show VWAP line", type: "toggle", default: true },
      { key: "vwapColor", label: "VWAP color", type: "select", default: "#14b8a6", options: CHART_COLORS },
      { key: "showSupportResistanceLines", label: "Show support/resistance lines", type: "toggle", default: true },
      { key: "showBollingerBands", label: "Show Bollinger Bands", type: "toggle", default: false },
      { key: "showRsiPanel", label: "RSI panel — show by default", type: "toggle", default: true },
      { key: "rsiOverbought", label: "RSI overbought threshold", description: "Red dashed threshold on the RSI panel", type: "slider", default: 70, min: 60, max: 90 },
      { key: "rsiOversold", label: "RSI oversold threshold", description: "Green dashed threshold on the RSI panel", type: "slider", default: 30, min: 10, max: 40 },
      { key: "showMacdPanel", label: "MACD panel — show by default", type: "toggle", default: false },
      { key: "showAtrPanel", label: "ATR panel — show by default", type: "toggle", default: false },
      { key: "show52WeekHighLowLines", label: "Show 52-week high/low lines", type: "toggle", default: true },
      { key: "showEarningsMarkersOnChart", label: "Show earnings date markers on chart", type: "toggle", default: true },
      { key: "showStrategyPriceLevels", label: "Show entry/target/stop price levels from strategy", type: "toggle", default: true },
      { key: "showPositionPnlOverlay", label: "Show current position P&L overlay on chart", type: "toggle", default: true },
      { key: "showBreakevenLines", label: "Show breakeven lines on chart", type: "toggle", default: true },
    ],
  },
  {
    id: "pnl",
    label: "P&L & Simulation",
    icon: <BarChart2 size={14} />,
    description: "How positions are valued, performance is calculated, and P&L is reported.",
    settings: [
      { key: "commissionPerContract", label: "Commission per contract", type: "number", default: 0.65, min: 0, step: 0.01, unit: "$" },
      { key: "perLegCommission", label: "Per-leg commission", type: "number", default: 0, min: 0, step: 0.01, unit: "$" },
      { key: "exchangeFeePerContract", label: "Exchange fees per contract", type: "number", default: 0.1, min: 0, step: 0.01, unit: "$" },
      { key: "includeCommissionsInPnl", label: "Include commissions in P&L calculations", type: "toggle", default: true },
      { key: "includeFeesInBreakeven", label: "Include fees in breakeven calculation", type: "toggle", default: true },
      { key: "contractMultiplier", label: "Default contract multiplier", type: "number", default: 100, min: 1, step: 1 },
      { key: "defaultContracts", label: "Default number of contracts", type: "slider", default: 1, min: 1, max: 50 },
      { key: "pnlDisplayMode", label: "Default P&L view", type: "select", default: "both", options: [{ label: "$ amount", value: "amount" }, { label: "% return", value: "percent" }, { label: "Both", value: "both" }] },
      { key: "showMaxProfitOnPnlCurve", label: "Show max profit in P&L curve", type: "toggle", default: true },
      { key: "showMaxLossOnPnlCurve", label: "Show max loss in P&L curve", type: "toggle", default: true },
      { key: "showBreakevenOnPnlCurve", label: "Show breakeven points on P&L curve", type: "toggle", default: true },
      { key: "showCurrentPriceOnPnlCurve", label: "Show current price marker on P&L curve", type: "toggle", default: true },
      { key: "pnlCurveResolution", label: "P&L curve resolution", type: "select", default: 100, options: [{ label: "50 points", value: 50 }, { label: "100 points", value: 100 }, { label: "200 points", value: 200 }] },
      { key: "scenarioUnderlyingMovePct", label: "Default underlying move", type: "slider", default: 5, min: 1, max: 50, unit: "%" },
      { key: "scenarioIvChangePct", label: "Default IV change", type: "slider", default: 10, min: 0, max: 100, unit: "%" },
      { key: "scenarioDteStepDays", label: "Default DTE steps", type: "number", default: 7, min: 1, max: 60, unit: "days" },
      { key: "showGreeksImpactInScenario", label: "Show Greeks impact in scenario", type: "toggle", default: true },
      { key: "showProbabilityOfProfit", label: "Show probability of profit in strategy panel", type: "toggle", default: true },
      { key: "defaultProfitTargetPct", label: "Default profit target", type: "slider", default: 50, min: 1, max: 100, unit: "%" },
      { key: "defaultStopLossPct", label: "Default stop loss", type: "slider", default: 100, min: 1, max: 300, unit: "%" },
      { key: "showProfitTargetLine", label: "Show profit target line on P&L curve", type: "toggle", default: true },
      { key: "showStopLossLine", label: "Show stop loss line on P&L curve", type: "toggle", default: true },
      { key: "autoCalculateProfitTarget", label: "Auto-calculate suggested profit target", type: "toggle", default: true },
      { key: "defaultIvAssumption", label: "Default IV assumption", type: "select", default: "current", options: [{ label: "Use current IV rank", value: "current" }, { label: "Use manual IV", value: "manual" }] },
      { key: "riskFreeRatePct", label: "Default risk-free rate", type: "number", default: 4.5, min: 0, step: 0.1, unit: "%" },
      { key: "dividendYieldAssumptionPct", label: "Default dividend yield assumption", type: "number", default: 0, min: 0, step: 0.1, unit: "%" },
      { key: "useHistoricalVolatilityForSimulation", label: "Use historical volatility instead of IV", type: "toggle", default: false },
    ],
  },
  {
    id: "greeks",
    label: "Greeks & Options Display",
    icon: <SlidersHorizontal size={14} />,
    description: "Control Greeks visibility, delta targeting, IV context, chain liquidity, and theta displays.",
    settings: [
      { key: "showDelta", label: "Show Delta", type: "toggle", default: true },
      { key: "showGamma", label: "Show Gamma", type: "toggle", default: false },
      { key: "showTheta", label: "Show Theta", type: "toggle", default: true },
      { key: "showVega", label: "Show Vega", type: "toggle", default: true },
      { key: "showRho", label: "Show Rho", type: "toggle", default: false },
      { key: "greeksPrecision", label: "Greeks precision", description: "Decimal places used for displayed Greeks", type: "select", default: 2, options: [{ label: "2 decimal places", value: 2 }, { label: "4 decimal places", value: 4 }] },
      { key: "showPortfolioGreeksSummary", label: "Show portfolio-level Greeks summary", type: "toggle", default: true },
      { key: "greeksDisplayFormat", label: "Greeks display format", type: "select", default: "perContract", options: [{ label: "Per contract", value: "perContract" }, { label: "Per share", value: "perShare" }] },
      { key: "shortPutDeltaMin", label: "Short put delta minimum", type: "number", default: 0.2, min: 0, max: 1, step: 0.01 },
      { key: "shortPutDeltaMax", label: "Short put delta maximum", type: "number", default: 0.3, min: 0, max: 1, step: 0.01 },
      { key: "shortCallDeltaMin", label: "Short call delta minimum", type: "number", default: 0.2, min: 0, max: 1, step: 0.01 },
      { key: "shortCallDeltaMax", label: "Short call delta maximum", type: "number", default: 0.3, min: 0, max: 1, step: 0.01 },
      { key: "longOptionDeltaMin", label: "Long option delta minimum", type: "number", default: 0.4, min: 0, max: 1, step: 0.01 },
      { key: "longOptionDeltaMax", label: "Long option delta maximum", type: "number", default: 0.6, min: 0, max: 1, step: 0.01 },
      { key: "highlightOutsideTargetDelta", label: "Highlight strikes outside target delta range", type: "toggle", default: true },
      { key: "showDeltaAsProbabilityItm", label: "Show delta as probability of ITM", type: "toggle", default: false },
      { key: "ivDisplayFormat", label: "IV display format", type: "select", default: "percent", options: [{ label: "% percentage", value: "percent" }, { label: "Decimal", value: "decimal" }] },
      { key: "showIvRankAlongsideIv", label: "Show IV rank alongside IV", type: "toggle", default: true },
      { key: "showIvPercentileAlongsideIvRank", label: "Show IV percentile alongside IV rank", type: "toggle", default: false },
      { key: "ivRankCalculationPeriod", label: "IV rank calculation period", type: "select", default: "1Y", options: [{ label: "30-day", value: "30D" }, { label: "60-day", value: "60D" }, { label: "1-year", value: "1Y" }] },
      { key: "highlightHighIvStocks", label: "Highlight high IV stocks in Scans", type: "toggle", default: true },
      { key: "highIvHighlightThreshold", label: "High IV threshold", description: "Highlight when IV rank is at or above this level", type: "slider", default: 60, min: 0, max: 100 },
      { key: "chainStrikeRange", label: "Strikes to show each side", type: "slider", default: 5, min: 3, max: 20 },
      { key: "defaultExpirationCount", label: "Expiration count to show", type: "slider", default: 4, min: 1, max: 12 },
      { key: "highlightITM", label: "Highlight in-the-money strikes", type: "toggle", default: true },
      { key: "showOpenInterestColumn", label: "Show open interest column", type: "toggle", default: true },
      { key: "showVolumeColumn", label: "Show volume column", type: "toggle", default: true },
      { key: "showBidAskSpreadColumn", label: "Show bid/ask spread column", type: "toggle", default: true },
      { key: "showTheoreticalValueColumn", label: "Show theoretical value column", type: "toggle", default: false },
      { key: "filterIlliquidOptionsAutomatically", label: "Filter out illiquid strikes automatically", type: "toggle", default: true },
      { key: "minOpenInterest", label: "Min open interest to show strike", type: "number", default: 100, min: 0, step: 1 },
      { key: "minContractVolume", label: "Min volume to show strike", type: "number", default: 10, min: 0, step: 1 },
      { key: "showDailyThetaDecay", label: "Show daily theta decay in strategy panel", type: "toggle", default: true },
      { key: "showThetaAsDollarsPerDay", label: "Show theta as $ per day", type: "toggle", default: true },
      { key: "showThetaDecayCurve", label: "Show theta decay curve", type: "toggle", default: false },
      { key: "thetaDecayWarningThresholdDte", label: "Theta decay warning threshold", description: "Highlight when theta accelerates at or below this DTE", type: "number", default: 21, min: 0, max: 365, unit: "DTE" },
    ],
  },
  {
    id: "watchlist",
    label: "Watchlist",
    icon: <Bookmark size={14} />,
    description: "Control watchlist limits, display columns, auto-add rules, alerts, and management tools.",
    settings: [
      { key: "maxWatchlistSize", label: "Max watchlist size", type: "slider", default: 50, min: 10, max: 200 },
      { key: "showWatchlistSizeWarning", label: "Show warning when approaching max size", type: "toggle", default: true },
      { key: "watchlistSizeWarningThresholdPct", label: "Warning threshold", type: "slider", default: 80, min: 10, max: 100, unit: "%" },
      { key: "allowDuplicateWatchlistSymbols", label: "Allow duplicate symbols across watchlists", type: "toggle", default: false },
      { key: "autoRemoveLowScoreWatchlistSymbols", label: "Auto-remove symbols below score threshold", type: "toggle", default: false },
      { key: "autoRemoveWatchlistScoreThreshold", label: "Auto-remove score threshold", type: "slider", default: 40, min: 0, max: 100 },
      { key: "watchlistDefaultSort", label: "Default sort column", type: "select", default: "symbol", options: [{ label: "Symbol", value: "symbol" }, { label: "Score", value: "score" }, { label: "Price", value: "price" }, { label: "Change %", value: "changePercent" }, { label: "Setup Type", value: "setupType" }] },
      { key: "watchlistDefaultSortDirection", label: "Default sort direction", type: "select", default: "asc", options: [{ label: "Ascending", value: "asc" }, { label: "Descending", value: "desc" }] },
      { key: "watchlistShowOpportunityScore", label: "Show opportunity score", type: "toggle", default: true },
      { key: "watchlistShowSetupTypeBadge", label: "Show setup type badge", type: "toggle", default: true },
      { key: "watchlistShowLastUpdated", label: "Show last updated timestamp", type: "toggle", default: true },
      { key: "watchlistShowEarnings", label: "Show earnings date", type: "toggle", default: true },
      { key: "watchlistShowIVRank", label: "Show IV rank", type: "toggle", default: true },
      { key: "watchlistShowDailyChange", label: "Show daily change", type: "toggle", default: true },
      { key: "compactWatchlistView", label: "Compact watchlist view", type: "toggle", default: false },
      { key: "autoAddHighConvictionToWatchlist", label: "Auto-add high conviction setups", type: "toggle", default: false },
      { key: "autoAddWatchlistOpportunityThreshold", label: "Auto-add minimum opportunity score", type: "slider", default: 80, min: 0, max: 100 },
      { key: "autoAddOnlyPreferredStrategies", label: "Auto-add only for preferred strategies", type: "toggle", default: true },
      { key: "maxWatchlistAutoAddsPerDay", label: "Max auto-adds per day", type: "slider", default: 5, min: 1, max: 20 },
      { key: "notifyOnWatchlistAutoAdd", label: "Notify when symbol is auto-added", type: "toggle", default: true },
      { key: "alertWatchlistScoreDrop", label: "Alert when watched symbol score drops", type: "toggle", default: false },
      { key: "watchlistScoreDropAlertThreshold", label: "Score drop alert threshold", type: "slider", default: 60, min: 0, max: 100 },
      { key: "watchlistEarningsAlertDays", label: "Earnings alert window", type: "number", default: 5, min: 1, max: 30, unit: "days" },
      { key: "watchlistIvSpikeAlertThreshold", label: "IV rank spike alert threshold", type: "slider", default: 70, min: 0, max: 100 },
      { key: "showWatchlistAlertBadges", label: "Show alerts as badges on watchlist items", type: "toggle", default: true },
      { key: "allowMultipleWatchlists", label: "Allow multiple watchlists", description: "Manage multiple named watchlists (separate tabs)", type: "toggle", default: false },
      { key: "defaultWatchlistName", label: "Default watchlist name", type: "select", default: "My Watchlist", options: [{ label: "My Watchlist", value: "My Watchlist" }, { label: "Trading Ideas", value: "Trading Ideas" }, { label: "High Conviction", value: "High Conviction" }] },
    ],
  },
  {
    id: "positions",
    label: "Positions",
    icon: <Briefcase size={14} />,
    description: "Control P&L display, grouping, management alerts, analytics, and Tastytrade sync behavior.",
    settings: [
      { key: "positionsPnlDisplayFormat", label: "Default P&L display format", type: "select", default: "both", options: [{ label: "$ amount", value: "amount" }, { label: "% return", value: "percent" }, { label: "Both", value: "both" }] },
      { key: "showUnrealizedPnl", label: "Show unrealized P&L", type: "toggle", default: true },
      { key: "showRealizedPnl", label: "Show realized P&L", type: "toggle", default: true },
      { key: "showDailyPnlChange", label: "Show daily P&L change", type: "toggle", default: true },
      { key: "pnlColorScheme", label: "P&L color scheme", type: "select", default: "greenRed", options: [{ label: "Green/red default", value: "greenRed" }, { label: "Blue/orange alternative", value: "blueOrange" }] },
      { key: "showPnlAsPctOfMaxProfit", label: "Show P&L as % of max profit for defined-risk trades", type: "toggle", default: true },
      { key: "positionsGroupBy", label: "Group positions by", type: "select", default: "none", options: [{ label: "None", value: "none" }, { label: "Underlying", value: "underlying" }, { label: "Strategy", value: "strategy" }, { label: "Sector", value: "sector" }, { label: "Expiration", value: "expiration" }] },
      { key: "showPositionGroupSubtotals", label: "Show group subtotals", type: "toggle", default: true },
      { key: "collapsePositionGroupsByDefault", label: "Collapse groups by default", type: "toggle", default: false },
      { key: "showPortfolioGreeksPerGroup", label: "Show portfolio Greeks per group", type: "toggle", default: true },
      { key: "showClosedPositions", label: "Show closed positions", type: "toggle", default: true },
      { key: "closedPositionHistoryDays", label: "Days of closed position history to show", type: "slider", default: 30, min: 7, max: 365, unit: "days" },
      { key: "showClosedPositionsSeparateSection", label: "Show closed positions in separate section", type: "toggle", default: true },
      { key: "includeClosedPositionsInPnlTotals", label: "Include closed positions in P&L totals", type: "toggle", default: true },
      { key: "defaultProfitTargetPct", label: "Default profit target for new positions", description: "Percent of max profit", type: "slider", default: 50, min: 1, max: 100, unit: "%" },
      { key: "defaultStopLossPct", label: "Default stop loss for new positions", description: "Percent of max loss", type: "slider", default: 100, min: 1, max: 300, unit: "%" },
      { key: "showProfitTargetMarker", label: "Show profit target marker in positions table", type: "toggle", default: true },
      { key: "showStopLossMarker", label: "Show stop loss marker in positions table", type: "toggle", default: true },
      { key: "alertPositionProfitTarget", label: "Alert when position hits profit target", type: "toggle", default: true },
      { key: "alertPositionStopLoss", label: "Alert when position hits stop loss", type: "toggle", default: true },
      { key: "autoCalculateDaysInTrade", label: "Auto-calculate days in trade", type: "toggle", default: true },
      { key: "showPositionThetaDecayPerDay", label: "Show theta decay per day for each position", type: "toggle", default: true },
      { key: "showPositionsPortfolioGreeksSummary", label: "Show portfolio Greeks summary at top of positions page", type: "toggle", default: true },
      { key: "showBuyingPowerUsedPct", label: "Show buying power used %", type: "toggle", default: true },
      { key: "showPortfolioDeltaExposure", label: "Show portfolio delta exposure", type: "toggle", default: true },
      { key: "showSectorAllocationChart", label: "Show sector allocation chart", type: "toggle", default: true },
      { key: "showStrategyAllocationChart", label: "Show strategy allocation chart", type: "toggle", default: true },
      { key: "showWinRateStatistics", label: "Show win rate statistics", type: "toggle", default: true },
      { key: "winRateCalculationPeriod", label: "Win rate calculation period", type: "select", default: "90D", options: [{ label: "30-day", value: "30D" }, { label: "90-day", value: "90D" }, { label: "1-year", value: "1Y" }, { label: "All-time", value: "ALL" }] },
      { key: "autoSyncTastytradePositions", label: "Auto-sync positions from Tastytrade", type: "toggle", default: true },
      { key: "tastytradePositionSyncInterval", label: "Sync interval", type: "select", default: "1m", options: [{ label: "1min", value: "1m" }, { label: "5min", value: "5m" }, { label: "15min", value: "15m" }, { label: "Manual only", value: "manual" }] },
      { key: "showManualPositions", label: "Show positions not in Tastytrade", description: "Manual positions", type: "toggle", default: true },
      { key: "matchTastytradePositionDisplay", label: "Match Tastytrade position display format", type: "toggle", default: false },
      { key: "positionsDefaultSort", label: "Default sort", type: "select", default: "openDate", options: [{ label: "Open date (newest)", value: "openDate" }, { label: "P&L ($)", value: "pnlAbs" }, { label: "P&L (%)", value: "pnlPct" }, { label: "DTE (soonest)", value: "dte" }, { label: "Symbol", value: "symbol" }] },
      { key: "autoCloseAtExpiry", label: "Auto-close at expiry warning", description: "Surface a reminder to close positions within 1 DTE", type: "toggle", default: false },
      { key: "pnlAlertThreshold", label: "Daily P&L alert", description: "Alert when daily P&L exceeds this amount (absolute)", type: "number", default: 1000, min: 0, unit: "$" },
    ],
  },
  {
    id: "security",
    label: "Security & Account",
    icon: <Lock size={14} />,
    description: "Protect sensitive account data, manage sessions, inspect account health, and handle data maintenance.",
    settings: [
      { key: "hideSensitiveData", label: "Hide sensitive data mode", description: "Mask account numbers, balances, and P&L values for screensharing.", type: "toggle", default: false },
      { key: "hideBuyingPowerDisplay", label: "Hide buying power display", type: "toggle", default: false },
      { key: "hidePositionSizes", label: "Hide position sizes", type: "toggle", default: false },
      { key: "hidePnlValues", label: "Hide P&L values", type: "toggle", default: false },
      { key: "showSensitiveDataHiddenBanner", label: "Show Sensitive Data Hidden banner", type: "toggle", default: true },
      { key: "autoLogoutTimer", label: "Auto-logout timer", type: "select", default: "never", options: [{ label: "Never", value: "never" }, { label: "30 minutes", value: "30m" }, { label: "1 hour", value: "1h" }, { label: "2 hours", value: "2h" }, { label: "4 hours", value: "4h" }] },
      { key: "requirePasswordForCredentialChanges", label: "Require password confirmation before changing API keys or credentials", type: "toggle", default: true },
      { key: "lockSettingsPageWithPassword", label: "Lock settings page with password", type: "toggle", default: false },
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

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: 110, background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 6, color: "hsl(var(--foreground))",
        fontSize: 12, fontWeight: 500, padding: "5px 10px",
        outline: "none",
      }}
    />
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
      case "time":
        return <TimeInput value={String(value ?? setting.default)} onChange={v => onChange(setting.key, v)} />;
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

type SettingsStatusPayload = {
  database: { status: "connected" | "error"; latencyMs?: number; error?: string };
  polygon: { status: "connected" | "disconnected" | "error" | "rate_limited" };
  tastytrade: { status: "connected" | "disconnected" | "token_expired"; tokenExpiresAt: number | null };
  serverUptimeMs: number;
  lastScreenerRefresh: string | null;
  appVersion: string;
  nodeVersion: string;
  storage: {
    screenerCacheSize: number;
    screenerCacheBytes: number;
    watchlistSize: number;
    settingsSize: number;
    settingsBytes: number;
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
    if (settings.requirePasswordForCredentialChanges) {
      const typed = prompt('Type "CONFIRM" to save credential changes.');
      if (typed !== "CONFIRM") return;
    }
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
        <ActionRow label={flushStatus === "saving" ? "Clearing cache" : flushStatus === "success" ? "Cache cleared ✓" : "Flush Cache"} description="Clears in-memory Scans data and the Postgres screener_cache table" icon={flushStatus === "saving" ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={13} />} onClick={flushCache} />
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

const STRATEGY_WEIGHT_KEYS: Array<keyof AppSettings> = [
  "technicalScoreWeight",
  "ivScoreWeight",
  "momentumScoreWeight",
  "entryScoreWeight",
  "riskScoreWeight",
];

function StrategyPreferencesPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const weightTotal = STRATEGY_WEIGHT_KEYS.reduce((sum, key) => sum + Number(settings[key] ?? 0), 0);
  const allSettings = CATEGORIES.find(category => category.id === "strategy")!.settings;
  const ivSettings = allSettings.slice(0, 3);
  const weightSettings = allSettings.slice(3);

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>IV Environment Preferences</div>
        {ivSettings.map(setting => (
          <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
        ))}
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>Strategy Scoring Weights</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: weightTotal > 110 ? "hsl(var(--destructive))" : "hsl(var(--foreground))" }}>Total {weightTotal} / 110</div>
        </div>
        {weightTotal > 110 && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "hsl(var(--destructive) / 0.10)", color: "hsl(var(--destructive))", fontSize: 12, fontWeight: 600 }}>
            Total weights exceed 110. Opportunity scores will still be capped at 100.
          </div>
        )}
        {weightSettings.map(setting => (
          <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
        ))}
      </div>

      <ActionRow
        label="Reset to Defaults"
        description="Restore every Strategy Preferences option to its default value"
        icon={<RotateCcw size={13} />}
        onClick={onReset}
      />
    </div>
  );
}

const RISK_SECTION_SLICES = [
  { label: "Position Sizing", start: 0, end: 3 },
  { label: "Loss Limits", start: 3, end: 7 },
  { label: "Position Limits", start: 7, end: 11 },
  { label: "Options-Specific", start: 11, end: 17 },
  { label: "Display", start: 17, end: 20 },
] as const;

function formatSettingCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function RiskSummaryItem({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" | "danger" }) {
  const color = tone === "danger" ? "hsl(var(--destructive))" : tone === "warning" ? "hsl(38 92% 50%)" : "hsl(var(--foreground))";
  return (
    <div style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 750, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function RiskManagementPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const riskSettings = CATEGORIES.find(category => category.id === "risk")!.settings;
  const portfolioSize = Math.max(0, Number(settings.portfolioSize ?? SETTING_DEFAULTS.portfolioSize));
  const maxPositionValue = portfolioSize * Number(settings.maxPositionPct ?? SETTING_DEFAULTS.maxPositionPct) / 100;
  const suggestedPositionSize = Math.min(
    maxPositionValue,
    Number(settings.maxCapitalPerTrade ?? SETTING_DEFAULTS.maxCapitalPerTrade),
  );
  const deployedCap = portfolioSize * Number(settings.maxTotalCapitalDeployedPct ?? SETTING_DEFAULTS.maxTotalCapitalDeployedPct) / 100;
  const maxDrawdown = portfolioSize * Number(settings.maxPortfolioDrawdownPct ?? SETTING_DEFAULTS.maxPortfolioDrawdownPct) / 100;

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Risk Summary</div>
            <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Current portfolio guardrails at a glance.</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 999, color: settings.showRiskWarnings ? "hsl(38 92% 50%)" : "hsl(var(--muted-foreground))", background: settings.showRiskWarnings ? "hsl(38 92% 50% / 0.10)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {settings.showRiskWarnings ? "Warnings On" : "Warnings Off"}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <RiskSummaryItem label="Suggested Size" value={formatSettingCurrency(suggestedPositionSize)} />
          <RiskSummaryItem label="Capital Cap" value={formatSettingCurrency(settings.maxCapitalPerTrade)} />
          <RiskSummaryItem label="Trade Loss Cap" value={formatSettingCurrency(settings.maxSingleLoss)} tone="danger" />
          <RiskSummaryItem label="Deployed Cap" value={formatSettingCurrency(deployedCap)} tone="warning" />
          <RiskSummaryItem label="Drawdown Cap" value={formatSettingCurrency(maxDrawdown)} tone="danger" />
          <RiskSummaryItem label="DTE Window" value={`${settings.riskMinDTE}-${settings.riskMaxDTE}d`} />
        </div>
      </div>

      {RISK_SECTION_SLICES.map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {riskSettings.slice(section.start, section.end).map(setting => (
            <SettingRow
              key={setting.key}
              setting={setting}
              value={settings[setting.key as keyof AppSettings]}
              onChange={onChange}
            />
          ))}
        </div>
      ))}

      <ActionRow
        label="Reset to Defaults"
        description="Restore every Risk Management option to its default value"
        icon={<RotateCcw size={13} />}
        onClick={onReset}
      />
    </div>
  );
}

const TIME_HORIZON_SECTION_SLICES = [
  { label: "Expiration Cycle Preferences", start: 3, end: 6 },
  { label: "Earnings Awareness", start: 6, end: 11 },
  { label: "Theta Decay Preferences", start: 11, end: 16 },
  { label: "Time-Based Rules", start: 16, end: 20 },
] as const;

function RangeSliderInput({
  minValue,
  maxValue,
  min,
  max,
  minLimit,
  onChange,
}: {
  minValue: number;
  maxValue: number;
  min: number;
  max: number;
  minLimit: number;
  onChange: (values: { minValue: number; maxValue: number }) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{minValue}d</span>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>to</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{maxValue}d</span>
      </div>
      <input type="range" value={minValue} min={min} max={Math.min(maxValue - minLimit, 180)} onChange={e => onChange({ minValue: Number(e.target.value), maxValue })} style={{ accentColor: "hsl(var(--primary))" }} />
      <input type="range" value={maxValue} min={Math.max(minValue + minLimit, 7)} max={max} onChange={e => onChange({ minValue, maxValue: Number(e.target.value) })} style={{ accentColor: "hsl(var(--primary))" }} />
    </div>
  );
}

function CycleCheckboxes({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const options = [
    { label: "Weekly", value: "weekly" },
    { label: "Monthly", value: "monthly" },
    { label: "Quarterly", value: "quarterly" },
    { label: "LEAPS", value: "leaps" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 12 }}>
      {options.map(option => {
        const checked = value.includes(option.value);
        return (
          <label key={option.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, border: checked ? "1px solid hsl(var(--primary) / 0.35)" : "1px solid rgba(255,255,255,0.08)", background: checked ? "hsl(var(--primary) / 0.10)" : "rgba(255,255,255,0.03)", color: checked ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? value.filter(item => item !== option.value) : [...value, option.value])}
              style={{ accentColor: "hsl(var(--primary))" }}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

function formatEtTime(value: string): string {
  const [h = "0", m = "0"] = value.split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m.padStart(2, "0")} ${suffix} ET`;
}

function TimeHorizonPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const timeSettings = CATEGORIES.find(category => category.id === "timeHorizon")!.settings;
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const differsFromEt = localTimezone !== "America/New_York";

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>Default DTE Settings</div>
        <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Default DTE range</div>
              <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Overrides Risk Management DTE limits for strategy recommendations.</div>
            </div>
            <div style={{ width: 220, flexShrink: 0 }}>
              <RangeSliderInput
                minValue={settings.minDTE}
                maxValue={settings.maxDTE}
                min={0}
                max={365}
                minLimit={7}
                onChange={({ minValue, maxValue }) => {
                  onChange("minDTE", minValue);
                  onChange("maxDTE", maxValue);
                }}
              />
            </div>
          </div>
        </div>
        <SettingRow setting={timeSettings[2]!} value={settings.showDteRangeFilterDefault} onChange={onChange} />
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>Expiration Cycle Preferences</div>
        <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Preferred expiration cycles</div>
          <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Used by the options chain for highlighting and warnings.</div>
          <CycleCheckboxes value={settings.preferredExpirationCycles} onChange={value => onChange("preferredExpirationCycles", value)} />
        </div>
        {timeSettings.slice(4, 6).map(setting => (
          <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
        ))}
      </div>

      {TIME_HORIZON_SECTION_SLICES.slice(1).map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {section.label === "Time-Based Rules" && (
            <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.03)", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
              Trading window is {formatEtTime(settings.preferredTradingWindowStart)} to {formatEtTime(settings.preferredTradingWindowEnd)}. {differsFromEt ? `Your local timezone is ${localTimezone}.` : "Your local timezone matches ET."}
            </div>
          )}
          {timeSettings.slice(section.start, section.end).map(setting => (
            <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
          ))}
        </div>
      ))}

      <ActionRow
        label="Reset to Defaults"
        description="Restore every Time Horizon option to its default value"
        icon={<RotateCcw size={13} />}
        onClick={onReset}
      />
    </div>
  );
}

const CHART_SECTION_SLICES = [
  { label: "Default Chart Settings", start: 0, end: 4 },
  { label: "Moving Averages", start: 4, end: 14 },
  { label: "Indicators", start: 14, end: 24 },
  { label: "Price Levels", start: 24, end: 27 },
  { label: "P&L Overlay", start: 27, end: 29 },
] as const;

const CHART_COLOR_OPTIONS = ["#60a5fa", "#f59e0b", "#a78bfa", "#22c55e", "#f97316", "#14b8a6", "#ef4444", "#eab308"];

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 180 }}>
      {CHART_COLOR_OPTIONS.map(color => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          title={color}
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            border: value === color ? "2px solid hsl(var(--foreground))" : "1px solid rgba(255,255,255,0.15)",
            background: color,
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}

function ChartPreview({ settings }: { settings: AppSettings }) {
  const line = "M 0 46 C 30 28, 52 32, 82 20 S 140 32, 176 14 S 230 24, 278 8";
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Preview</div>
      <svg viewBox="0 0 280 96" width="100%" style={{ display: "block", borderRadius: 6, background: "rgba(0,0,0,0.32)" }}>
        {[20, 48, 76].map(y => <line key={y} x1="0" x2="280" y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />)}
        {settings.showBollingerBands && <path d="M 0 30 C 45 18, 70 26, 100 14 S 160 24, 190 10 S 240 18, 278 6" fill="none" stroke="rgba(255,255,255,0.18)" strokeDasharray="4 5" />}
        {settings.chartStyle === "area" && <path d={`${line} L 278 80 L 0 80 Z`} fill="hsl(var(--primary) / 0.18)" />}
        {settings.chartStyle === "line" || settings.chartStyle === "area" ? (
          <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
        ) : (
          Array.from({ length: 18 }).map((_, i) => {
            const x = 12 + i * 14;
            const high = 20 + ((i * 7) % 24);
            const low = high + 28;
            const open = high + 8 + (i % 3) * 3;
            const close = high + 13 + ((i + 1) % 3) * 3;
            const up = close < open;
            return (
              <g key={i}>
                <line x1={x} x2={x} y1={high} y2={low} stroke={up ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                {settings.chartStyle === "ohlc" ? (
                  <>
                    <line x1={x - 5} x2={x} y1={open} y2={open} stroke={up ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                    <line x1={x} x2={x + 5} y1={close} y2={close} stroke={up ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                  </>
                ) : (
                  <rect x={x - 4} y={Math.min(open, close)} width="8" height={Math.max(2, Math.abs(open - close))} rx="1" fill={up ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                )}
              </g>
            );
          })
        )}
        {settings.showSMA20 && <path d="M 0 50 C 60 42, 100 44, 150 28 S 220 30, 280 18" fill="none" stroke={settings.sma20Color} strokeWidth="1.6" />}
        {settings.showSMA50 && <path d="M 0 58 C 70 50, 120 54, 168 38 S 230 42, 280 30" fill="none" stroke={settings.sma50Color} strokeWidth="1.6" />}
        {settings.showSMA200 && <path d="M 0 68 C 80 62, 150 60, 280 48" fill="none" stroke={settings.sma200Color} strokeWidth="1.6" />}
        {settings.showVWAPLine && <path d="M 0 42 L 280 36" fill="none" stroke={settings.vwapColor} strokeWidth="1.4" strokeDasharray="5 5" />}
        {settings.showSupportResistanceLines && (
          <>
            <line x1="0" x2="280" y1="72" y2="72" stroke="hsl(var(--success))" strokeDasharray="5 5" opacity="0.5" />
            <line x1="0" x2="280" y1="16" y2="16" stroke="hsl(var(--destructive))" strokeDasharray="5 5" opacity="0.5" />
          </>
        )}
      </svg>
    </div>
  );
}

function ChartAnalysisPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const chartSettings = CATEGORIES.find(category => category.id === "chartAnalysis")!.settings;
  const colorKeys = new Set(["sma20Color", "sma50Color", "sma200Color", "ema9Color", "ema21Color", "vwapColor"]);

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <ChartPreview settings={settings} />
      {CHART_SECTION_SLICES.map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {chartSettings.slice(section.start, section.end).map(setting => colorKeys.has(setting.key) ? (
            <div key={setting.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{setting.label}</div>
              <ColorPicker value={String(settings[setting.key as keyof AppSettings] ?? SETTING_DEFAULTS[setting.key as keyof AppSettings])} onChange={value => onChange(setting.key, value)} />
            </div>
          ) : (
            <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
          ))}
        </div>
      ))}
      <ActionRow
        label="Reset to Defaults"
        description="Restore every Chart & Analysis option to its default value"
        icon={<RotateCcw size={13} />}
        onClick={onReset}
      />
    </div>
  );
}

const PNL_SECTION_SLICES = [
  { label: "Commission & Fees", start: 0, end: 5 },
  { label: "Contract Settings", start: 5, end: 7 },
  { label: "P&L Display", start: 7, end: 13 },
  { label: "Scenario Analysis", start: 13, end: 18 },
  { label: "Profit & Loss Targets", start: 18, end: 23 },
  { label: "Simulation", start: 23, end: 27 },
] as const;

function PnlSimulationPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const pnlSettings = CATEGORIES.find(category => category.id === "pnl")!.settings;
  const contracts = Math.max(1, Number(settings.defaultContracts));
  const optionLegs = 2;
  const estimatedFees =
    (settings.includeCommissionsInPnl ? settings.commissionPerContract * contracts * optionLegs + settings.perLegCommission * optionLegs : 0) +
    settings.exchangeFeePerContract * contracts * optionLegs;

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>P&L Cost Preview</div>
        <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Estimated round-trip cost for a 2-leg strategy using the default contract count.</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <RiskSummaryItem label="Contracts" value={String(contracts)} />
          <RiskSummaryItem label="Multiplier" value={String(settings.contractMultiplier)} />
          <RiskSummaryItem label="Estimated Fees" value={formatSettingCurrency(estimatedFees)} tone={estimatedFees > 0 ? "warning" : "default"} />
          <RiskSummaryItem label="Curve Points" value={String(settings.pnlCurveResolution)} />
        </div>
      </div>

      {PNL_SECTION_SLICES.map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {pnlSettings.slice(section.start, section.end).map(setting => (
            <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
          ))}
        </div>
      ))}

      <ActionRow
        label="Reset to Defaults"
        description="Restore every P&L & Simulation option to its default value"
        icon={<RotateCcw size={13} />}
        onClick={onReset}
      />
    </div>
  );
}

const GREEKS_SECTION_SLICES = [
  { label: "Greeks Display", start: 0, end: 8 },
  { label: "Delta Preferences", start: 8, end: 16 },
  { label: "IV Display", start: 16, end: 22 },
  { label: "Options Chain Display", start: 22, end: 34 },
  { label: "Theta Display", start: 34, end: 38 },
] as const;

function GreeksOptionsPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const greekSettings = CATEGORIES.find(category => category.id === "greeks")!.settings;
  const visibleGreeks = [
    settings.showDelta ? "Delta" : null,
    settings.showGamma ? "Gamma" : null,
    settings.showTheta ? "Theta" : null,
    settings.showVega ? "Vega" : null,
    settings.showRho ? "Rho" : null,
  ].filter(Boolean).join(", ") || "None";

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Options Display Preview</div>
        <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Current chain and strategy display rules at a glance.</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <RiskSummaryItem label="Visible Greeks" value={visibleGreeks} />
          <RiskSummaryItem label="Delta Zone" value={`${settings.shortPutDeltaMin.toFixed(2)}-${settings.shortPutDeltaMax.toFixed(2)}`} />
          <RiskSummaryItem label="IV Rank Period" value={settings.ivRankCalculationPeriod} />
          <RiskSummaryItem label="Liquidity Floor" value={`${settings.minOpenInterest} OI / ${settings.minContractVolume} vol`} tone="warning" />
        </div>
      </div>

      {GREEKS_SECTION_SLICES.map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {greekSettings.slice(section.start, section.end).map(setting => (
            <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
          ))}
        </div>
      ))}

      <ActionRow
        label="Reset to Defaults"
        description="Restore every Greeks & Options Display option to its default value"
        icon={<RotateCcw size={13} />}
        onClick={onReset}
      />
    </div>
  );
}

const WATCHLIST_SECTION_SLICES = [
  { label: "Watchlist Behavior", start: 0, end: 6 },
  { label: "Watchlist Display", start: 6, end: 15 },
  { label: "Auto-Add Rules", start: 15, end: 20 },
  { label: "Watchlist Alerts", start: 20, end: 25 },
  { label: "Watchlist Management", start: 25, end: 27 },
] as const;

function WatchlistSettingsPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const watchlistSettings = CATEGORIES.find(category => category.id === "watchlist")!.settings;
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [qualifyingCount, setQualifyingCount] = useState(0);
  const [isClearing, setIsClearing] = useState(false);
  const warningAt = Math.round(settings.maxWatchlistSize * settings.watchlistSizeWarningThresholdPct / 100);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/watchlist").then(r => r.ok ? r.json() : []),
      fetch("/api/screener").then(r => r.ok ? r.json() : []),
    ]).then(([watchlist, rows]) => {
      if (cancelled) return;
      const watched = new Set((Array.isArray(watchlist) ? watchlist : []).map((item: any) => String(item.symbol).toUpperCase()));
      const preferred = new Set(settings.preferredStrategies.map(strategy => strategy.toLowerCase()));
      const qualifies = (Array.isArray(rows) ? rows : []).filter((row: any) => {
        if (watched.has(String(row.symbol).toUpperCase())) return false;
        if (Number(row.opportunityScore ?? 0) < settings.autoAddWatchlistOpportunityThreshold) return false;
        if (!settings.autoAddOnlyPreferredStrategies) return true;
        return preferred.has(String(row.setupType ?? "").toLowerCase());
      });
      setWatchlistCount(Array.isArray(watchlist) ? watchlist.length : 0);
      setQualifyingCount(qualifies.length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [settings.autoAddOnlyPreferredStrategies, settings.autoAddWatchlistOpportunityThreshold, settings.preferredStrategies]);

  const exportCsv = useCallback(() => {
    window.location.href = "/api/watchlist/export";
  }, []);

  const clearWatchlist = useCallback(async () => {
    if (!confirm("Clear all watchlist items? This cannot be undone.")) return;
    setIsClearing(true);
    try {
      const response = await fetch("/api/watchlist", { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      setWatchlistCount(0);
    } finally {
      setIsClearing(false);
    }
  }, []);

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{settings.defaultWatchlistName}</div>
        <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Current watchlist capacity and auto-add eligibility.</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <RiskSummaryItem label="Current Size" value={`${watchlistCount}/${settings.maxWatchlistSize}`} tone={settings.showWatchlistSizeWarning && watchlistCount >= warningAt ? "warning" : "default"} />
          <RiskSummaryItem label="Warning Starts" value={`${warningAt} symbols`} />
          <RiskSummaryItem label="Auto-Add Qualifies" value={String(qualifyingCount)} tone={qualifyingCount > 0 ? "warning" : "default"} />
          <RiskSummaryItem label="Daily Auto-Add Cap" value={String(settings.maxWatchlistAutoAddsPerDay)} />
        </div>
      </div>

      {WATCHLIST_SECTION_SLICES.map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {watchlistSettings.slice(section.start, section.end).map(setting => (
            <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
          ))}
        </div>
      ))}

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>Actions</div>
        <ActionRow label="Export watchlist to CSV" description="Download the current watchlist with alerts and market fields" icon={<Download size={13} />} onClick={exportCsv} />
        <ActionRow label={isClearing ? "Clearing..." : "Clear all watchlist items"} description="Remove every symbol from the current watchlist" icon={<Trash2 size={13} />} onClick={clearWatchlist} variant="danger" />
        <ActionRow label="Reset to Defaults" description="Restore every Watchlist option to its default value" icon={<RotateCcw size={13} />} onClick={onReset} />
      </div>
    </div>
  );
}

const POSITIONS_SECTION_SLICES = [
  { label: "P&L Display", start: 0, end: 6 },
  { label: "Position Grouping", start: 6, end: 10 },
  { label: "Closed Positions", start: 10, end: 14 },
  { label: "Position Management", start: 14, end: 22 },
  { label: "Portfolio Analytics", start: 22, end: 29 },
  { label: "Tastytrade Sync", start: 29, end: 33 },
  { label: "Defaults & Alerts", start: 33, end: 36 },
] as const;

function PositionsSettingsPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const positionSettings = CATEGORIES.find(category => category.id === "positions")!.settings;
  const visibleAnalytics = [
    settings.showPositionsPortfolioGreeksSummary ? "Greeks" : null,
    settings.showBuyingPowerUsedPct ? "Buying power" : null,
    settings.showPortfolioDeltaExposure ? "Delta" : null,
    settings.showSectorAllocationChart ? "Sector chart" : null,
    settings.showStrategyAllocationChart ? "Strategy chart" : null,
    settings.showWinRateStatistics ? "Win rate" : null,
  ].filter(Boolean).join(", ") || "None";

  const syncLabel =
    settings.tastytradePositionSyncInterval === "manual"
      ? "Manual only"
      : settings.tastytradePositionSyncInterval.replace("m", " min");

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Positions Display Preview</div>
        <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Current grouping, management targets, and sync cadence.</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <RiskSummaryItem label="P&L Format" value={String(settings.positionsPnlDisplayFormat)} />
          <RiskSummaryItem label="Grouping" value={String(settings.positionsGroupBy)} />
          <RiskSummaryItem label="Targets" value={`${settings.defaultProfitTargetPct}% / ${settings.defaultStopLossPct}%`} tone="warning" />
          <RiskSummaryItem label="Sync" value={settings.autoSyncTastytradePositions ? syncLabel : "Off"} />
          <RiskSummaryItem label="Closed History" value={`${settings.closedPositionHistoryDays}d`} />
          <RiskSummaryItem label="Analytics" value={visibleAnalytics} />
        </div>
      </div>

      {POSITIONS_SECTION_SLICES.map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {positionSettings.slice(section.start, section.end).map(setting => (
            <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
          ))}
        </div>
      ))}

      <ActionRow
        label="Reset to Defaults"
        description="Restore every Positions option to its default value"
        icon={<RotateCcw size={13} />}
        onClick={onReset}
      />
    </div>
  );
}

const SECURITY_SECTION_SLICES = [
  { label: "Display Security", start: 0, end: 5 },
  { label: "Session Security", start: 5, end: 9 },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${totalSeconds % 60}s`;
}

function formatStatusDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function StatusDot({ status }: { status: string }) {
  const ok = status === "connected";
  const warning = status === "rate_limited" || status === "token_expired";
  const error = status === "disconnected" || status === "error";
  const color = ok ? "hsl(var(--success))" : warning ? "hsl(38 92% 50%)" : error ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))";
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 10px ${color}55`, flexShrink: 0 }} />;
}

function ConfirmActionRow({
  label,
  description,
  icon,
  onConfirm,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  onConfirm: () => void | Promise<void>;
}) {
  const run = useCallback(async () => {
    if (!confirm(`${label}? This action cannot be undone.`)) return;
    const typed = prompt('Type "CONFIRM" to continue.');
    if (typed !== "CONFIRM") return;
    await onConfirm();
  }, [label, onConfirm]);

  return <ActionRow label={label} description={description} icon={icon} onClick={run} variant="danger" />;
}

function SecuritySettingsPanel({
  settings,
  onChange,
  onReset,
  onResetAll,
}: {
  settings: AppSettings;
  onChange: (key: string, value: unknown) => void;
  onReset: () => void;
  onResetAll: () => void;
}) {
  const securitySettings = CATEGORIES.find(category => category.id === "security")!.settings;
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SettingsStatusPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await apiJson<SettingsStatusPayload>("/api/settings/status"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 30_000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
      await refreshStatus();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [refreshStatus]);

  const clearScansCache = useCallback(() => runAction("scans", async () => {
    const response = await fetch("/api/screener/flush", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    queryClient.invalidateQueries({ queryKey: ["screener-stats"] });
  }), [queryClient, runAction]);

  const clearWatchlistCache = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    alert("Watchlist cache cleared. The next watchlist view will refetch from the server.");
  }, [queryClient]);

  const clearWatchlist = useCallback(() => runAction("watchlist", async () => {
    const response = await fetch("/api/watchlist", { method: "DELETE" });
    if (!response.ok) throw new Error(await response.text());
    queryClient.invalidateQueries();
  }), [queryClient, runAction]);

  const clearCachedData = useCallback(() => runAction("cache", async () => {
    const response = await fetch("/api/screener/flush", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    queryClient.clear();
  }), [queryClient, runAction]);

  const exportSettings = useCallback(async () => {
    await runAction("export", async () => {
      const response = await fetch("/api/settings/export", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `optionsos-settings-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [runAction]);

  const importSettings = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "settings" in parsed ? parsed : { settings: parsed };
        if (!payload.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) {
          throw new Error("Settings import must be a JSON object.");
        }
        await runAction("import", async () => {
          const response = await fetch("/api/settings/import", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new Error(await response.text());
          await queryClient.invalidateQueries({ queryKey: ["settings"] });
        });
      } catch (err) {
        alert(`Import failed: ${(err as Error).message}`);
      }
    };
    input.click();
  }, [queryClient, runAction]);

  return (
    <div style={{ paddingTop: 8, display: "grid", gap: 24 }}>
      <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Security Snapshot</div>
        <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Sensitive display mode, session behavior, and live account health.</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <RiskSummaryItem label="Hide Mode" value={settings.hideSensitiveData ? "Active" : "Off"} tone={settings.hideSensitiveData ? "warning" : "default"} />
          <RiskSummaryItem label="Auto Logout" value={settings.autoLogoutTimer === "never" ? "Never" : settings.autoLogoutTimer} />
          <RiskSummaryItem label="Uptime" value={status ? formatDuration(status.serverUptimeMs) : "Loading"} />
          <RiskSummaryItem label="Settings Stored" value={status ? String(status.storage.settingsSize) : "Loading"} />
        </div>
      </div>

      {SECURITY_SECTION_SLICES.map(section => (
        <div key={section.label}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{section.label}</div>
          {securitySettings.slice(section.start, section.end).map(setting => (
            <SettingRow key={setting.key} setting={setting} value={settings[setting.key as keyof AppSettings]} onChange={onChange} />
          ))}
        </div>
      ))}

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>Cache & Data</div>
        <ActionRow label={busy === "scans" ? "Clearing..." : "Clear Scans cache"} description="Flush server Scans rows through POST /api/screener/flush" icon={<RotateCcw size={13} />} onClick={clearScansCache} />
        <ActionRow label="Clear watchlist cache" description="Drop the frontend watchlist cache and refetch on next view" icon={<RotateCcw size={13} />} onClick={clearWatchlistCache} />
        <ActionRow label={busy === "export" ? "Exporting..." : "Export all settings as JSON"} description="Download a timestamped backup file" icon={<Download size={13} />} onClick={exportSettings} />
        <ActionRow label={busy === "import" ? "Importing..." : "Import settings from JSON"} description="Validate a backup file before applying it" icon={<Upload size={13} />} onClick={importSettings} />
        <ConfirmActionRow label="Clear all user settings and reset to defaults" description="Erase every user_settings row and reload defaults" icon={<Trash2 size={13} />} onConfirm={onResetAll} />
        {status && (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <RiskSummaryItem label="Scans Cache" value={`${status.storage.screenerCacheSize} rows`} />
            <RiskSummaryItem label="Scans Bytes" value={formatBytes(status.storage.screenerCacheBytes)} />
            <RiskSummaryItem label="Watchlist Size" value={`${status.storage.watchlistSize} symbols`} />
            <RiskSummaryItem label="Settings Size" value={formatBytes(status.storage.settingsBytes)} />
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>Account Info</div>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {[
            ["Database", status?.database.status ?? "loading", status?.database.latencyMs != null ? `${status.database.latencyMs}ms` : ""],
            ["Polygon API", status?.polygon.status ?? "loading", ""],
            ["Tastytrade", status?.tastytrade.status ?? "loading", status?.tastytrade.tokenExpiresAt ? `expires ${new Date(status.tastytrade.tokenExpiresAt).toLocaleString()}` : ""],
            ["Server uptime", status ? formatDuration(status.serverUptimeMs) : "loading", ""],
            ["Last Scans refresh", status ? formatStatusDate(status.lastScreenerRefresh) : "loading", ""],
            ["App version", status?.appVersion ?? "loading", ""],
            ["Node.js version", status?.nodeVersion ?? "loading", ""],
          ].map(([label, value, detail]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusDot status={String(value)} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "capitalize" }}>{String(value).replace(/_/g, " ")}</div>
                {detail && <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{detail}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ border: "1px solid rgba(239,68,68,0.32)", borderRadius: 8, background: "rgba(239,68,68,0.05)", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "hsl(var(--destructive))", fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
          <AlertTriangle size={15} />
          Danger Zone
        </div>
        <ConfirmActionRow label="Reset all settings to defaults" description="Delete all user settings after double confirmation" icon={<RotateCcw size={13} />} onConfirm={onResetAll} />
        <ConfirmActionRow label="Clear all cached data" description="Flush Scans cache and clear client-side query cache" icon={<HardDrive size={13} />} onConfirm={clearCachedData} />
        <ConfirmActionRow label="Clear watchlist" description="Delete every saved watchlist symbol" icon={<Trash2 size={13} />} onConfirm={clearWatchlist} />
      </div>

      <ActionRow label="Reset to Defaults" description="Restore every Security & Account option to its default value" icon={<RotateCcw size={13} />} onClick={onReset} />
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

            {activeCategory === "strategy" && (
              <StrategyPreferencesPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "risk" && (
              <RiskManagementPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "timeHorizon" && (
              <TimeHorizonPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "chartAnalysis" && (
              <ChartAnalysisPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "pnl" && (
              <PnlSimulationPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "greeks" && (
              <GreeksOptionsPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "watchlist" && (
              <WatchlistSettingsPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "positions" && (
              <PositionsSettingsPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
              />
            )}

            {activeCategory === "security" && (
              <SecuritySettingsPanel
                settings={settings}
                onChange={handleChange}
                onReset={() => handleResetCategory(activeCategoryDef)}
                onResetAll={handleResetToDefaults}
              />
            )}

            {/* All other categories */}
            {activeCategory !== "security" && activeCategory !== "data" && activeCategory !== "strategy" && activeCategory !== "risk" && activeCategory !== "timeHorizon" && activeCategory !== "chartAnalysis" && activeCategory !== "pnl" && activeCategory !== "greeks" && activeCategory !== "watchlist" && activeCategory !== "positions" && (
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
                      description="Restore every Scans & Scoring option to its default value"
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
