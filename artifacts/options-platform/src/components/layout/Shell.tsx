import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 md:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-primary font-bold tracking-tight">
            <Activity className="h-5 w-5" />
            <span>OptionsPlay</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            <Link 
              href="/" 
              className={cn(
                "px-3 py-1.5 rounded-md transition-colors",
                location === "/" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              Workspace
            </Link>
            <Link 
              href="/dashboard" 
              className={cn(
                "px-3 py-1.5 rounded-md transition-colors",
                location === "/dashboard" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              Dashboard
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs font-mono text-success flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
            </span>
            MARKET OPEN
          </div>
          <div className="h-4 w-px bg-border"></div>
          <button className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
