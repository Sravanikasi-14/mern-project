import {
  Award,
  BarChart3,
  Bell,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock,
  FileText,
  Hand,
  Home,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  LogOut,
  MailPlus,
  MapPin,
  Monitor,
  RefreshCw,
  RotateCcw,
  Settings2,
  Target,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  WalletCards,
} from "lucide-react";

const DEFAULT_STROKE = 1.85;

const ICONS = {
  people: Users,
  payroll: Wallet,
  assets: Monitor,
  offers: MailPlus,
  onboarding: UserPlus,
  work: Briefcase,
  impact: Award,
  policies: FileText,
  reports: BarChart3,
  settings: Settings2,
  payslips: WalletCards,
  profile: UserRound,
  documents: FileText,
  clock: Clock,
  leave: CalendarDays,
  location: MapPin,
  holidays: CalendarCheck,
  hours: RotateCcw,
  lifecycle: Target,
  help: LifeBuoy,
  lock: Lock,
  bell: Bell,
  logout: LogOut,
  refresh: RefreshCw,
  punch: Hand,
  star: Award,
  tasks: CheckSquare,
  home: Home,
  dashboard: LayoutDashboard,
  clipboard: ClipboardList,
};

export default function Icon({
  name,
  size = 20,
  strokeWidth = DEFAULT_STROKE,
  className = "",
  style,
  children,
  ...rest
}) {
  const LucideIcon = name ? ICONS[name] : null;

  if (LucideIcon) {
    return (
      <LucideIcon
        size={size}
        strokeWidth={strokeWidth}
        absoluteStrokeWidth={false}
        className={className}
        style={{ display: "inline-block", verticalAlign: "middle", ...style }}
        aria-hidden="true"
        {...rest}
      />
    );
  }

  // Fallback for rare custom children paths (kept for compatibility)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", ...style }}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Brand mark — kept as a local SVG, not from Lucide. */
export function LeafIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="currentColor" aria-hidden="true">
      <path d="M16 4c6 2 12 9 12 16-7 0-12 0-16-4 4 4 4 9 4 16C9 28 2 22 4 16 11 16 14 10 16 4z" />
    </svg>
  );
}
