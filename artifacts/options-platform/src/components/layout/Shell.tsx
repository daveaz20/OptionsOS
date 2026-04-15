import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground font-sans">
      <header className="flex h-14 shrink-0 items-center justify-between glass-panel px-4 md:px-6 z-50">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-foreground font-semibold tracking-tight">
            <Activity className="h-5 w-5 text-primary" />
            <span>OptionsPlay</span>
          </Link>
          <nav className="hidden md:flex items-center gap-2 text-sm font-medium">
            <Link 
              href="/" 
              className={cn(
                "px-3 py-1.5 rounded-full transition-all duration-200",
                location === "/" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              Workspace
            </Link>
            <Link 
              href="/dashboard" 
              className={cn(
                "px-3 py-1.5 rounded-full transition-all duration-200",
                location === "/dashboard" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              Dashboard
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-xs font-medium text-success flex items-center gap-2 bg-success/10 px-2.5 py-1 rounded-full">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success"></span>
            </span>
            Market Open
          </div>
          <div className="h-4 w-px bg-white/10"></div>
          <button className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-full hover:bg-white/10">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden flex flex-col relative z-0">
        {children}
      </main>
    </div>
  );
}