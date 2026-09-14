"use client";
import { useEffect, useState } from "react";

const KEY = "pos-theme";
export type Theme = "light" | "dark" | "system";

/** Applies the theme before hydration to avoid a flash. */
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('${KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => { try { setThemeState((localStorage.getItem(KEY) as Theme) || "system"); } catch {} }, []);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(KEY, t); } catch {}
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  return { theme, setTheme };
}
