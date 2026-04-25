import { useState, useEffect } from "react";

export function useMarketOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function check() {
      try {
        const etStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
        const et = new Date(etStr);
        const day = et.getDay();
        if (day === 0 || day === 6) { setOpen(false); return; }
        const totalMin = et.getHours() * 60 + et.getMinutes();
        setOpen(totalMin >= 9 * 60 + 30 && totalMin < 16 * 60);
      } catch {
        setOpen(false);
      }
    }
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  return open;
}
