import { Cloud, Search, Code, Languages, Newspaper, Bot, PenTool, Users } from "lucide-react";
import type { Theme } from "./i18n";

export const ICON_MAP: Record<string, React.ComponentType<{ size?: string | number }>> = {
  cloud: Cloud,
  search: Search,
  code: Code,
  languages: Languages,
  newspaper: Newspaper,
  bot: Bot,
  "pen-tool": PenTool,
  users: Users,
};

export const ROLE_COLORS = [
  "#f97316", "#3b82f6", "#22c55e", "#a855f7",
  "#ef4444", "#14b8a6", "#ec4899", "#eab308",
];

export function applyTheme(theme: Theme) {
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}
