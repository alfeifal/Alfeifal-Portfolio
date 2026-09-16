import { Home, Sparkles, CalendarDays, CheckSquare, Wallet, TrendingUp, CandlestickChart, Newspaper, Dumbbell, Apple, GraduationCap, Languages, Target, FolderKanban, BookOpen, BarChart3, Bell, Settings, type LucideIcon, ClipboardList, FileText, Search as SearchIcon } from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; group: "core" | "life" | "money" | "learn" | "system" }

/** Module registry for navigation (spec §5). Adding a module = one line here + a route. */
export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, group: "core" },
  { href: "/assistant", label: "Assistant", icon: Sparkles, group: "core" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, group: "core" },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, group: "core" },
  { href: "/planner", label: "Planner", icon: ClipboardList, group: "core" },
  { href: "/finance", label: "Finance", icon: Wallet, group: "money" },
  { href: "/investing", label: "Investing", icon: TrendingUp, group: "money" },
  { href: "/trading", label: "Trading", icon: CandlestickChart, group: "money" },
  { href: "/news", label: "Market News", icon: Newspaper, group: "money" },
  { href: "/training", label: "Training", icon: Dumbbell, group: "life" },
  { href: "/nutrition", label: "Nutrition", icon: Apple, group: "life" },
  { href: "/studies", label: "Studies", icon: GraduationCap, group: "learn" },
  { href: "/german", label: "German", icon: Languages, group: "learn" },
  { href: "/goals", label: "Goals", icon: Target, group: "life" },
  { href: "/projects", label: "Projects", icon: FolderKanban, group: "life" },
  { href: "/journal", label: "Journal", icon: BookOpen, group: "life" },
  { href: "/search", label: "Search", icon: SearchIcon, group: "system" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, group: "system" },
  { href: "/reviews", label: "Reviews", icon: FileText, group: "system" },
  { href: "/notifications", label: "Notifications", icon: Bell, group: "system" },
  { href: "/settings", label: "Settings", icon: Settings, group: "system" },
];
export const MOBILE_TABS = ["/", "/assistant", "/calendar", "/tasks"];
