import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Bell,
  CalendarDays,
  CalendarOff,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Clock,
  FileText,
  FolderKanban,
  Info,
  LayoutDashboard,
  ListTodo,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Monitor,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  Download,
  Eye,
  EyeOff,
  Timer,
  TimerOff,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import "./EmployeeIcon.css";

const DEFAULT_STROKE = 1.75;

const ICONS = {
  dashboard: LayoutDashboard,
  home: LayoutDashboard,
  profile: UserRound,
  user: UserRound,
  attendance: Clock,
  clock: Clock,
  leave: CalendarDays,
  calendar: CalendarDays,
  "calendar-plus": CalendarPlus,
  payslips: WalletCards,
  pay: WalletCards,
  assets: Monitor,
  monitor: Monitor,
  tasks: ListTodo,
  impact: Award,
  star: Award,
  settings: Settings2,
  more: MoreHorizontal,
  documents: FileText,
  file: FileText,
  logout: LogOut,
  login: LogIn,
  menu: Menu,
  bell: Bell,
  "check-circle": CheckCircle2,
  timer: Timer,
  "timer-off": TimerOff,
  "calendar-off": CalendarOff,
  "map-pin": MapPin,
  refresh: RefreshCw,
  search: Search,
  download: Download,
  check: Check,
  close: X,
  alert: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  dollar: CircleDollarSign,
  "circle-alert": CircleAlert,
  shield: Shield,
  mail: Mail,
  eye: Eye,
  "eye-off": EyeOff,
  pencil: Pencil,
  folder: FolderKanban,
};

export function EmployeeIcon({
  name,
  icon: IconProp,
  size = 18,
  strokeWidth = DEFAULT_STROKE,
  filled = false,
  className = "",
  style,
  ...rest
}) {
  const Icon = IconProp || ICONS[name];
  if (!Icon) return null;

  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={false}
      fill={filled ? "currentColor" : "none"}
      className={["emp-icon", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
      {...rest}
    />
  );
}

function createIcon(icon, defaultSize = 18) {
  function NamedIcon({ size = defaultSize, ...props }) {
    return <EmployeeIcon icon={icon} size={size} {...props} />;
  }
  return NamedIcon;
}

export const IconClose = createIcon(X, 16);
export const IconCheck = createIcon(Check);
export const IconClock = createIcon(Clock);
export const IconCalendar = createIcon(CalendarDays);
export const IconCalendarPlus = createIcon(CalendarPlus);
export const IconAlertCircle = createIcon(AlertCircle);
export const IconAlertTriangle = createIcon(AlertTriangle);
export const IconInfo = createIcon(Info);
export const IconArrowLeft = createIcon(ArrowLeft);
export const IconArrowRight = createIcon(ArrowRight);
export const IconChevronLeft = createIcon(ChevronLeft);
export const IconChevronRight = createIcon(ChevronRight);
export const IconDollar = createIcon(CircleDollarSign);
export const IconDownload = createIcon(Download);
export const IconFileText = createIcon(FileText);
export const IconDocument = createIcon(FileText);
export const IconSearch = createIcon(Search);
export const IconRefresh = createIcon(RefreshCw);
export const IconUser = createIcon(UserRound);
export const IconShield = createIcon(Shield);
export const IconMail = createIcon(Mail);
export const IconSettings = createIcon(Settings2);
export const IconEye = createIcon(Eye);
export const IconEyeOff = createIcon(EyeOff);
export const IconMapPin = createIcon(MapPin);
export const IconLogIn = createIcon(LogIn);
export const IconLogOut = createIcon(LogOut);
export const IconMonitor = createIcon(Monitor);
export const IconAward = createIcon(Award);
export const IconPencil = createIcon(Pencil);
export const IconFolder = createIcon(FolderKanban);
export const IconBell = createIcon(Bell, 22);
export const IconMenu = createIcon(Menu, 22);
export const IconCheckCircle = createIcon(CheckCircle2);
export const IconTimer = createIcon(Timer);
export const IconTimerOff = createIcon(TimerOff);
export const IconCalendarOff = createIcon(CalendarOff);
export const IconCircleAlert = createIcon(CircleAlert);

export const EMPLOYEE_NAV_ICONS = {
  dashboard: "dashboard",
  profile: "profile",
  attendance: "attendance",
  leave: "leave",
  payslips: "payslips",
  assets: "assets",
  tasks: "tasks",
  "impact-points": "impact",
  settings: "settings",
};

export default EmployeeIcon;
