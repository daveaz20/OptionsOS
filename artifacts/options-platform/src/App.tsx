import { Suspense, lazy, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "next-themes";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/layout/Shell";
import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";

function ThemeSync() {
  const { setTheme } = useTheme();
  const { settings } = useSettings();
  useEffect(() => {
    const theme = settings.theme || "dark";
    setTheme(theme);

    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [settings.theme, setTheme]);
  return null;
}

function DefaultRoute() {
  const { settings } = useSettings();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (settings.defaultPage && settings.defaultPage !== "/") {
      navigate(settings.defaultPage, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (settings.defaultPage && settings.defaultPage !== "/") return null;
  return <DashboardPage />;
}

const ScannerPage = lazy(() => import("@/pages/workspace"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const ScreenerPage = lazy(() => import("@/pages/screener"));
const PositionsPage = lazy(() => import("@/pages/positions"));
const WatchlistPage = lazy(() => import("@/pages/watchlist"));
const SettingsPage = lazy(() => import("@/pages/settings"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Shell>
      <Suspense fallback={<div className="h-full w-full bg-background" />}>
        <Switch>
          <Route path="/" component={DefaultRoute} />
          <Route path="/scanner" component={ScannerPage} />
          <Route path="/screener" component={ScreenerPage} />
          <Route path="/watchlist" component={WatchlistPage} />
          <Route path="/positions" component={PositionsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" attribute="class">
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <SettingsProvider>
              <ThemeSync />
              <Router />
            </SettingsProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
