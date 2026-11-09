export const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

/** Floating hero chips — capability labels, not fabricated metrics. */
export const HERO_CHIPS = [
  { label: "People", icon: "people" },
  { label: "Attendance", icon: "pulse" },
  { label: "Payroll", icon: "pay" },
];

/** Conceptual journey cards for the How It Works Tumble Deck (not app screenshots). */
export const HOW_DECK_CARDS = [
  {
    src: "/images/landing/how/setup-org.svg",
    alt: "Set Up Your Organization — configure company details, departments, and designations",
  },
  {
    src: "/images/landing/how/people.svg",
    alt: "Bring Your People Together — add employees and organize your workforce",
  },
  {
    src: "/images/landing/how/operations.svg",
    alt: "Run Everyday HR Operations — attendance, leave, hiring, and payroll",
  },
  {
    src: "/images/landing/how/work.svg",
    alt: "Keep Work Moving — tasks, progress, and connected employees",
  },
];

export const HOW_STEPS = [
  {
    step: "01",
    title: "Set Up Your Organization",
    body: "Configure company details, departments, designations and reporting structure.",
  },
  {
    step: "02",
    title: "Bring Your People Together",
    body: "Add employees, manage profiles and organize your workforce.",
  },
  {
    step: "03",
    title: "Run Everyday HR Operations",
    body: "Manage attendance, leave, hiring, payroll and employee services.",
  },
  {
    step: "04",
    title: "Keep Work Moving",
    body: "Coordinate tasks, track progress and keep employees connected.",
  },
];

export const FAQ_ITEMS = [
  {
    id: "what-is-hrms",
    question: "What is HRMS and what can it help my company manage?",
    answer:
      "HRMS is a company-scoped people operations platform. It helps you manage employees, organization structure, attendance, leave, payroll and payslips, hiring and onboarding, assets, work tasks, Impact Points, and internal messages in one workspace.",
  },
  {
    id: "who-can-use",
    question: "Who can use the HRMS platform?",
    answer:
      "Three roles use HRMS today: Company Admin for organization setup and HR access, HR Admin for day-to-day people operations, and Employee for self-service actions such as punches, leave, payslips, tasks, and messages.",
  },
  {
    id: "departments",
    question: "Can we configure our company departments and designations?",
    answer:
      "Yes. Company Admins can define departments, designations, and reporting relationships so people data stays aligned with how your organization is structured.",
  },
  {
    id: "attendance-leave",
    question: "How does employee attendance and leave management work?",
    answer:
      "Employees can check in and out and submit leave requests. HR Admins review attendance, exceptions, and leave approvals so workforce availability and balances stay visible in one place.",
  },
  {
    id: "payroll",
    question: "Does HRMS support payroll processing and payslips?",
    answer:
      "Yes. HR Admins can run payroll cycles using connected attendance and leave inputs, then publish payslips for employees to view in their portal.",
  },
  {
    id: "hiring",
    question: "How does the hiring and onboarding workflow work?",
    answer:
      "HR can move candidates through offers and onboarding in HRMS — from preparing an offer to candidate review and bringing a new hire into the company workspace.",
  },
  {
    id: "self-service",
    question: "Can employees access HR services themselves?",
    answer:
      "Yes. Employees use a self-service portal for attendance punches, leave requests, payslips, tasks, documents, profile details, and messages without relying on email threads for routine requests.",
  },
  {
    id: "mobile",
    question: "Can employees use HRMS on mobile devices?",
    answer:
      "Yes. Alongside the web portals, HRMS includes a mobile experience so employees can handle everyday HR actions on their phones.",
  },
];
