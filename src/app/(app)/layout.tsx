import Link from "next/link";
import { requireUser, upgradePath } from "@/lib/auth/current";
import { NAV } from "@/lib/nav";
import { NavLinks } from "@/components/nav-links";
import { MobileNav } from "@/components/mobile-nav";
import { MobileTabBar } from "@/components/mobile-tabbar";
import { BranchSwitcher } from "@/components/branch-switcher";
import { UserMenu } from "@/components/user-menu";
import { photoUrl } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlobalSearch } from "@/components/global-search";
import { SideLogo } from "@/components/side-logo";
import { BellLink, TrialBanner } from "@/components/shell";
import { AskAi } from "@/components/ask-ai";
import { navCounts } from "@/lib/services/shell";
import { getGymProfile, getIdleMinutes } from "@/lib/services/settings";
import { IdleSignout } from "@/components/idle-signout";
import { CookieBanner } from "@/components/cookie-banner";
import { ProductTour } from "@/components/product-tour";
import { getSubscriptionSettings } from "@/lib/services/subscription";
import { getAiSettings } from "@/lib/services/ai-settings";
import { gymLogoUrl } from "@/components/gym-logo";
import { gymPlan } from "@/lib/services/saas";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { lowestGymPrice } from "@/lib/domain/pricing";
import { daysBetween } from "@/lib/domain/dates";
import { todayIso } from "@/lib/services/time";
import { fmtDate, formatInr } from "@/lib/format";

const fromPrice = formatInr(lowestGymPrice("MONTHLY")).replace(/\.00$/, "");

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const u = await requireUser();
  const [counts, plan, profile, sub, ai, idleMinutes] = await Promise.all([navCounts(u), gymPlan(u.orgId), getGymProfile(u.orgId), getSubscriptionSettings(u.orgId), getAiSettings(u.orgId), getIdleMinutes(u.orgId)]);
  const gymName = profile.name || u.orgName;
  const logo = gymLogoUrl(profile.logoKey);
  const s = plan.standing;
  const today = todayIso();
  const left = s.kind === "TRIAL" ? daysBetween(s.until, today) + 1 : s.kind === "PAID" ? daysBetween(s.until, today) : 0;
  // Prototype: a paid plan nearing its end shows "ends in N days" as many days ahead as Settings › Subscription says.
  const expiring = s.kind === "PAID" && left <= sub.remindDays;
  const canPay = u.can("settings.manage");
  const banner =
    s.kind === "TRIAL"
      ? {
          alert: left <= 2,
          body: (
            <>
              Free trial:{" "}
              <strong>
                {left} {left === 1 ? "day" : "days"} left
              </strong>{" "}
              · ends {fmtDate(s.until)}. Your account locks after the trial.
            </>
          ),
          cta: `Upgrade from ${fromPrice}/month`,
        }
      : expiring
        ? {
            alert: left <= 1,
            body: (
              <>
                Your {plan.name} plan ends in{" "}
                <strong>
                  {left} {left === 1 ? "day" : "days"}
                </strong>{" "}
                ({fmtDate(s.until)}). Pay now to keep everything running.
              </>
            ),
            cta: "Renew",
          }
        : s.kind === "GRACE"
          ? { alert: true, body: <>Your {plan.name} plan has ended. Renew before {fmtDate(s.readOnlyFrom)} to keep adding members and invoices.</>, cta: "Renew" }
          : s.kind === "LAPSED"
            ? { alert: true, body: <>Your FITRON plan has ended. Your data is safe; pay to keep adding members and invoices.</>, cta: "Choose a plan" }
            : null;
  // Sections the role may use stay listed even when the plan doesn't open them: locked, leading to the plans.
  // Fitron AI disappears altogether when a Super Admin switched it off (Settings › Integrations & AI).
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => (!i.perm || u.can(i.perm)) && (!i.anyPerm || i.anyPerm.some((p) => u.can(p))) && (ai.enabled || i.icon !== "ai"))
      .map((i) => (i.feature && !u.has(i.feature) ? { ...i, locked: true, href: upgradePath(u, i.feature) } : { ...i, badge: i.count ? counts[i.count] : undefined })),
  })).filter((g) => g.items.length);
  // The FITRON team (FITRON_ADMIN_EMAILS) also gets the console for the whole SaaS: every gym, user and rupee earned.
  if (isFitronAdmin(u.email)) groups.push({ group: "FITRON team", items: [{ href: "/fitron-admin", label: "FITRON admin", icon: "platform", badge: undefined }] });
  const branchName = u.branch === "ALL" ? "All branches (consolidated)" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-x-hidden overflow-y-auto border-r border-line-soft bg-surface px-3.5 pb-6 lg:flex">
        <Link href="/dashboard" className="mt-4 -mb-1 block w-[200px]" aria-label="Dashboard">
          <SideLogo src={logo} name={gymName} />
        </Link>
        <div className="flex flex-col gap-0.5 px-2">
          <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Tenant</div>
          <div className="text-[15px] font-semibold">{gymName}</div>
          <div className="text-xs text-muted">{branchName}</div>
        </div>
        <NavLinks groups={groups} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line-soft bg-bg px-4 py-3 lg:px-10">
          <MobileNav groups={groups} orgName={gymName} branchName={branchName} logo={logo} branches={u.branches.filter((b) => b.active)} branch={u.branch} />
          <GlobalSearch />
          <div className="flex flex-none items-center gap-1.5 sm:gap-2.5 lg:ml-auto">
            <BranchSwitcher branches={u.branches.filter((b) => b.active)} value={u.branch} />
            <ThemeToggle />
            <BellLink unread={counts.notifications ?? 0} />
            <UserMenu
              user={{
                name: u.name,
                email: u.email,
                role: u.role,
                branch: u.branch === "ALL" ? "All branches" : (u.branches.find((b) => b.id === u.branch)?.name ?? ""),
                photo: photoUrl(u.id, u.photoKey),
                canSettings: canPay,
                plan: s.kind === "PAID" ? "Active" : s.kind === "TRIAL" ? "Free trial" : "Locked",
              }}
            />
          </div>
        </header>
        {banner && <TrialBanner alert={banner.alert} cta={canPay ? banner.cta : undefined}>{banner.body}</TrialBanner>}
        <main id="ft-main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-4 pb-20 max-lg:pb-24 lg:px-10">{children}</main>
      </div>
      <MobileTabBar canMembers={u.can("members.view")} canAdd={u.can("members.create")} canCollect={u.can("payments.collect")} home={groups[0]?.items[0]?.href ?? "/dashboard"} homeLabel={groups[0]?.items[0]?.href === "/dashboard" ? "Home" : (groups[0]?.items[0]?.label ?? "Home")} />
      {u.can("ai.use") && ai.enabled && <AskAi />}
      <IdleSignout minutes={idleMinutes} />
      <ProductTour
        firstName={u.name.split(" ")[0]}
        email={u.email}
        sections={Object.fromEntries(groups.flatMap((g) => g.items.filter((i) => !i.locked).map((i) => [i.icon, i.href])))}
      />
      <CookieBanner />
    </div>
  );
}
