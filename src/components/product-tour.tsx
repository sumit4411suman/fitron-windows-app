"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  BarbellIcon,
  BellIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CurrencyInrIcon,
  FingerprintIcon,
  FunnelIcon,
  GearSixIcon,
  HourglassMediumIcon,
  IdentificationCardIcon,
  PauseIcon,
  PlayIcon,
  ReceiptIcon,
  RepeatIcon,
  ScalesIcon,
  ScanIcon,
  SparkleIcon,
  SquaresFourIcon,
  StorefrontIcon,
  TagIcon,
  UsersThreeIcon,
  WalletIcon,
  WhatsappLogoIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";

/** Restarts the tour from the account menu. */
export const TOUR_EVENT = "fitron:tour";
const TOUR_MS = 7000;

type Section = { key: string; icon: Icon; title: string; body: string; pts: string[] };

// The prototype's tour (fitron-app.js A.TOUR): one card per section, in sidebar order.
const TOUR: Section[] = [
  { key: "dashboard", icon: SquaresFourIcon, title: "Dashboard", body: "Your gym at a glance. Collections, active members, renewals due and profit for any period.", pts: ["Switch period: Today, This month, Custom", "Click any number to open the list behind it", "Quick actions: add member, collect payment, invoice"] },
  { key: "members", icon: UsersThreeIcon, title: "Members", body: "Every member with their plan, expiry, balance and documents.", pts: ["Add member in 4 steps: details, plan, payment, documents", "Search by name, ID, phone or invoice", "Open a profile to renew, freeze, collect or message"] },
  { key: "leads", icon: FunnelIcon, title: "Leads & trials", body: "Walk-ins and enquiries before they join.", pts: ["Track stages from New to Joined", "Book a trial and follow up on WhatsApp", "Convert a lead into a member in one click"] },
  { key: "renewals", icon: ArrowsClockwiseIcon, title: "Renewals", body: "Members expiring today, in 3, 7, 15 days, or already expired.", pts: ["Send expiry reminders on WhatsApp", "Renew with plan, offer code and payment", "Renewals create a new membership record"] },
  { key: "attendance", icon: FingerprintIcon, title: "Attendance", body: "Check-ins by member ID, mobile or QR.", pts: ["Check members in and out", "See today’s count and busy hours", "Expired or frozen members are flagged"] },
  { key: "classes", icon: CalendarDotsIcon, title: "Classes", body: "Weekly class schedule with bookings and waitlists.", pts: ["Create classes with trainer and capacity", "Book members; waitlist fills automatically", "Mark attendance per class"] },
  { key: "invoices", icon: ReceiptIcon, title: "Invoices", body: "GST-ready branded invoices for memberships, PT and products.", pts: ["Create, print or save as PDF", "Send the invoice on WhatsApp or email", "Cancel with a reason; numbers are never reused"] },
  { key: "payments", icon: CurrencyInrIcon, title: "Payments", body: "The payment ledger: cash, UPI, card and bank.", pts: ["Collect full or part payments", "Every payment is linked to an invoice", "Reverse with a reason; nothing is deleted"] },
  { key: "autopay", icon: RepeatIcon, title: "UPI autopay", body: "Recurring UPI mandates for monthly members.", pts: ["Set up a mandate per member", "See upcoming and failed debits", "Retry, pause or cancel mandates"] },
  { key: "receivables", icon: HourglassMediumIcon, title: "Receivables", body: "Who owes money, how much and for how long.", pts: ["Filter: due today, overdue, part-paid", "Send a WhatsApp reminder per row", "Remind all overdue members at once"] },
  { key: "pos", icon: StorefrontIcon, title: "POS", body: "Sell supplements, drinks and merch at the counter.", pts: ["Scan or search products", "Sell to a member or walk-in", "Stock drops automatically; low stock is flagged"] },
  { key: "expenses", icon: WalletIcon, title: "Expenses", body: "Rent, salaries, electricity, equipment and more.", pts: ["Add an expense with bill photo or PDF", "Group by category and vendor", "Feeds straight into Profit & loss"] },
  { key: "accounting", icon: ScalesIcon, title: "Accounting", body: "Profit & loss, ledgers and month-end closing.", pts: ["P&L by month, quarter or year", "Income, expense, payment and receivable ledgers", "Lock a month after review"] },
  { key: "reports", icon: ChartBarIcon, title: "Reports", body: "One place for financial, membership and operational reports.", pts: ["Filter, sort and search any report", "Export to CSV, Excel or PDF", "Star your favourite reports"] },
  { key: "ai", icon: SparkleIcon, title: "Fitron AI", body: "An assistant that reads your live gym data.", pts: ["Daily brief: dues, expiries, members at risk", "Ask questions in plain words", "It suggests actions; you confirm before anything is sent"] },
  { key: "whatsapp", icon: WhatsappLogoIcon, title: "WhatsApp", body: "Automatic messages for welcome, payments, invoices and reminders.", pts: ["Edit templates with {{member_name}} style fields", "See sent, delivered, read and failed", "Run campaigns to selected members"] },
  { key: "programs", icon: BarbellIcon, title: "Workouts & diet", body: "Workout and diet plans with progress logs.", pts: ["Build plans from templates", "Assign to members", "Log weight and measurements"] },
  { key: "notifications", icon: BellIcon, title: "Notifications", body: "Alerts for expiries, dues, failed messages and more.", pts: ["Unread count in the top bar", "Click to jump to the member or invoice", "Mark all as read"] },
  { key: "plans", icon: TagIcon, title: "Plans & offers", body: "Membership plans, pricing and offer codes.", pts: ["Create plans with duration, fee and GST", "Deactivate old plans; history is kept", "Offer codes with limits and expiry"] },
  { key: "biometric", icon: ScanIcon, title: "Biometric", body: "Door access devices and entry logs.", pts: ["Connect fingerprint or face devices", "See allowed and denied entries", "Expired members are blocked at the door"] },
  { key: "staff", icon: IdentificationCardIcon, title: "Staff & roles", body: "Your team, their roles, and salary & payroll.", pts: ["Add staff with a role and branch", "Each role sees only what it should", "Pay salaries and advances; they post to expenses"] },
  { key: "audit", icon: ClockCounterClockwiseIcon, title: "Audit log", body: "Every important change, by whom and when.", pts: ["Filter by user or action", "Financial edits always leave a trail", "Useful for month-end review"] },
  { key: "settings", icon: GearSixIcon, title: "Settings", body: "Gym profile, GST, invoices, branches, WhatsApp and backups.", pts: ["Invoice prefix and GST rates", "Branches and reminder timing", "Import members, export data, back up and restore"] },
];

const doneKey = (email: string) => `fitron-tour-done-${email || "guest"}`;

/**
 * The first-login product tour (prototype): an intro card listing the sections, then a step card that opens
 * each section the person may use. Dismissal is remembered per user in this browser, as the prototype does.
 * `sections` maps a tour key to the section's page; sections the role cannot open are left out.
 */
export function ProductTour({ firstName, email, sections }: { firstName: string; email: string; sections: Record<string, string> }) {
  const router = useRouter();
  const steps = TOUR.filter((t) => sections[t.key]);
  const [tour, setTour] = useState<{ i: number; auto: boolean; t0: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const end = useCallback(
    (done: boolean) => {
      clearTimeout(timer.current);
      try {
        localStorage.setItem(doneKey(email), "1");
      } catch {}
      setTour(null);
      router.push("/dashboard");
      if (done) {
        setToast("Tour done. Restart it any time from your account menu.");
        setTimeout(() => setToast(null), 4000);
      }
    },
    [email, router],
  );

  const go = useCallback(
    (i: number, auto?: boolean) => {
      if (i >= steps.length) return end(true);
      setTour((t) => ({ i: Math.max(i, -1), auto: auto ?? t?.auto ?? true, t0: Date.now() }));
      if (i >= 0) router.push(sections[steps[i].key]);
    },
    [steps, sections, router, end],
  );

  // First login: open the intro once per user. Restart: the account menu fires TOUR_EVENT.
  useEffect(() => {
    let done: string | null = null;
    try {
      done = localStorage.getItem(doneKey(email));
    } catch {}
    const first = !done && steps.length > 0 ? setTimeout(() => setTour((t) => t ?? { i: -1, auto: true, t0: 0 }), 900) : undefined;
    const restart = () => setTour({ i: -1, auto: true, t0: 0 });
    window.addEventListener(TOUR_EVENT, restart);
    return () => {
      clearTimeout(first);
      window.removeEventListener(TOUR_EVENT, restart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // Auto-play: move on after a few seconds.
  const i = tour?.i ?? -1;
  const auto = tour?.auto ?? false;
  const t0 = tour?.t0 ?? 0;
  useEffect(() => {
    clearTimeout(timer.current);
    if (!tour || !auto || i < 0) return;
    timer.current = setTimeout(() => go(i + 1), TOUR_MS);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour === null, auto, i, t0]);

  useEffect(() => {
    if (!tour) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && end(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [tour, end]);

  const n = steps.length;
  const cur = i >= 0 ? steps[i] : null;
  return (
    <>
      {tour && !cur && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-4">
          <div role="dialog" aria-label="Product tour" className="flex max-h-[92vh] w-full max-w-[560px] flex-col gap-[18px] overflow-auto rounded-lg border border-accent-500/60 bg-surface p-7 shadow-lg">
            <div className="flex items-center gap-3.5">
              <Image src="/fitron-mark.png" alt="" width={52} height={52} className="size-[52px] object-contain" />
              <div>
                <div className="text-[11px] tracking-[0.08em] text-muted uppercase">Product tour · {n} sections</div>
                <h2 className="mt-1 mb-0 text-[28px] leading-[1.1]">
                  Welcome to Fitron, <em className="text-accent">{firstName}.</em>
                </h2>
              </div>
            </div>
            <div className="text-[15px] leading-[1.55] text-neutral-800">
              This short tour opens each section you have access to and explains what it does. It takes about two minutes. You can skip it now and restart it any time from your account menu.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {steps.map((s, j) => (
                <button key={s.key} type="button" onClick={() => go(j)} className="flex items-center gap-1.5 rounded-[14px] border border-line bg-transparent px-2.5 py-1 text-xs text-neutral-800 hover:border-accent hover:text-accent">
                  <s.icon weight="duotone" />
                  {s.title}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" onClick={() => end(false)} className="inline-flex py-2.5 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 text-sm leading-[1.2] font-semibold whitespace-nowrap text-accent hover:bg-accent/10">
                Skip tour
              </button>
              <button type="button" onClick={() => go(0)} className="inline-flex py-2.5 items-center justify-center gap-1.5 rounded-md border border-transparent bg-accent px-[18px] text-sm leading-[1.2] font-semibold whitespace-nowrap text-accent-ink hover:bg-accent-hover">
                <PlayIcon weight="duotone" />
                Start auto tour
              </button>
            </div>
          </div>
        </div>
      )}
      {tour && cur && (
        <>
          <div className="pointer-events-none fixed inset-0 z-[94] shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.18)]" />
          <div role="dialog" aria-label="Product tour" className="fixed right-5 bottom-4 z-[95] flex max-h-[calc(100vh-110px)] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-[14px] border border-accent-500/60 bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,0,0,0.3)] max-lg:bottom-[84px]">
            <div className="flex items-center justify-between gap-3 bg-gradient-to-b from-accent-soft to-transparent px-[18px] py-3.5">
              <div className="flex items-center gap-2">
                <Image src="/fitron-mark.png" alt="" width={22} height={22} className="size-[22px] object-contain" />
                <span className="text-[11px] tracking-[0.1em] text-muted uppercase">Product tour</span>
                <span className="rounded-[10px] bg-accent-soft px-2 py-0.5 text-[11px] text-accent tabular-nums">
                  {i + 1} / {n}
                </span>
              </div>
              <button type="button" onClick={() => end(false)} className="flex items-center gap-1 rounded-md bg-transparent px-1.5 py-1 text-xs text-muted hover:bg-neutral-200 hover:text-fg">
                Skip tour
                <XIcon weight="duotone" />
              </button>
            </div>
            <div className="mx-[18px] mt-0 mb-1.5 h-0.5 bg-neutral-200">{auto && <div key={`${i}-${t0}`} className="h-0.5 bg-accent" style={{ animation: `fitronTourBar ${TOUR_MS / 1000}s linear forwards` }} />}</div>
            <div className="flex gap-[3px] px-[18px]">
              {steps.map((s, j) => (
                <button key={s.key} type="button" onClick={() => go(j)} title={s.title} aria-label={s.title} className={`h-1 flex-1 rounded-sm border-0 p-0 ${j <= i ? "bg-accent" : "bg-neutral-300"}`} />
              ))}
            </div>
            <div className="flex flex-col gap-3.5 overflow-auto px-[18px] pt-[18px] pb-1.5">
              <div className="flex items-start gap-3.5">
                <span className="grid size-12 flex-none place-items-center rounded-xl border border-accent-500/60 bg-accent-soft text-accent">
                  <cur.icon size={26} weight="duotone" />
                </span>
                <div className="min-w-0">
                  <h3 className="m-0 text-2xl leading-[1.15]">{cur.title}</h3>
                  <div className="mt-1 text-sm leading-[1.5] text-neutral-800">{cur.body}</div>
                </div>
              </div>
              <div className="flex flex-col overflow-hidden rounded-[10px] border border-line">
                <div className="bg-bg px-3.5 py-[9px] text-[11px] tracking-[0.1em] text-muted uppercase">What you can do here</div>
                {cur.pts.map((p, k) => (
                  <div key={p} className="flex items-start gap-3 border-t border-line px-3.5 py-2.5 text-[13.5px] leading-[1.45]">
                    <span className="grid size-5 flex-none place-items-center rounded-full bg-accent text-[11px] font-semibold text-bg">{k + 1}</span>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2.5 border-t border-line bg-bg px-[18px] py-3.5">
              <button type="button" onClick={() => go(i - 1)} className="inline-flex py-2.5 items-center justify-center gap-1.5 rounded-md border border-line px-[18px] text-sm leading-[1.2] font-semibold whitespace-nowrap hover:bg-fg/7">
                <ArrowLeftIcon weight="duotone" />
                Back
              </button>
              <button type="button" onClick={() => setTour({ i, auto: !auto, t0: Date.now() })} className="flex items-center gap-1.5 rounded-2xl border border-line bg-transparent px-2.5 py-1.5 text-xs text-neutral-800 hover:border-accent hover:text-accent">
                {auto ? <PauseIcon weight="duotone" /> : <PlayIcon weight="duotone" />}
                {auto ? "Pause" : "Auto-play"} · {n - i - 1} left
              </button>
              <button type="button" onClick={() => go(i + 1)} className="inline-flex py-2.5 items-center justify-center gap-1.5 rounded-md border border-transparent bg-accent px-[18px] text-sm leading-[1.2] font-semibold whitespace-nowrap text-accent-ink hover:bg-accent-hover">
                {i + 1 >= n ? "Finish tour" : "Next"}
                <ArrowRightIcon weight="duotone" />
              </button>
            </div>
          </div>
        </>
      )}
      {toast && (
        <div className="fixed right-5 bottom-20 z-[120] flex max-w-[360px] items-start gap-2.5 rounded-lg border border-accent-500/60 bg-surface px-3.5 py-3 text-sm shadow-lg" role="status">
          <CheckCircleIcon size={18} weight="duotone" className="text-accent" />
          <span className="flex-1">{toast}</span>
        </div>
      )}
    </>
  );
}
