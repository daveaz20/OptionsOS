import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/layout/Shell";

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
          <Route path="/" component={DashboardPage} />
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
      <ThemeProvider defaultTheme="dark" attribute="class" forcedTheme="dark">
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
