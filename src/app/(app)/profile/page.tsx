import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/current";
import { readSession } from "@/lib/auth/session";
import { getProfile } from "@/lib/services/profile";
import { Avatar, photoUrl } from "@/components/avatar";
import { Card, Empty, cx } from "@/components/ui";
import { PasswordForm, PhotoForm, ProfileForm } from "./profile-forms";
import { TwoStepPanel } from "./two-step-panel";
import { pendingSetup, twoStepStatus } from "@/lib/services/two-step";
import { qrSvg } from "@/lib/integrations/qr";

export const metadata = { title: "My profile · Fitron" };

const when = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs tracking-wider text-muted uppercase">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const u = await requireUser();
  const tabQ = (await searchParams).tab;
  const tab = tabQ === "password" ? "password" : tabQ === "twostep" ? "twostep" : "profile";
  const session = await readSession();
  const me = await getProfile(u, session?.id ?? null);
  const branch = u.branch === "ALL" ? "All branches" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  const tabCls = (on: boolean) => cx("rounded-md px-4 py-1.5 text-sm", on ? "bg-accent font-semibold text-accent-ink" : "hover:bg-surface-2");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={me.name} src={photoUrl(u.id, me.photoKey)} className="size-20 text-2xl" />
        <div>
          <p className="text-xs tracking-wider text-muted uppercase">My account</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">{me.name}</h1>
          <p className="text-muted">
            {u.role} · {branch}
          </p>
        </div>
      </div>

      <div className="inline-flex gap-1 self-start rounded-lg border border-line bg-surface p-1" role="tablist">
        <Link href="/profile" role="tab" aria-selected={tab === "profile"} className={tabCls(tab === "profile")}>
          Profile
        </Link>
        <Link href="/profile?tab=password" role="tab" aria-selected={tab === "password"} className={tabCls(tab === "password")}>
          Password
        </Link>
        <Link href="/profile?tab=twostep" role="tab" aria-selected={tab === "twostep"} className={tabCls(tab === "twostep")}>
          Two-step sign-in
        </Link>
      </div>

      {tab === "profile" ? (
        <Card>
          <div className="flex flex-col gap-5">
            <PhotoForm hasPhoto={!!me.photoKey} />
            <ProfileForm name={me.name} phone={me.phone} />
            <div className="grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Login email">{me.email}</Fact>
              <Fact label="Role">{u.role}</Fact>
              <Fact label="Branch">{u.branches.map((b) => b.name).join(", ") || "—"}</Fact>
              <Fact label="This session since">{me.sessionSince ? when(me.sessionSince) : "—"}</Fact>
              <Fact label="Last sign-in">{me.lastLoginAt ? when(me.lastLoginAt) : "—"}</Fact>
              <Fact label="Account created">{when(me.createdAt)}</Fact>
            </div>
            <p className="text-xs text-muted">Your email, role and branches are set by the Super Admin in Staff.</p>
          </div>
        </Card>
      ) : tab === "password" ? (
        <Card>
          <PasswordForm />
        </Card>
      ) : (
        <TwoStepTab userId={u.id} />
      )}

      <div id="activity" className="-mb-6 scroll-mt-24" />
      <Card title="My activity" action={u.can("audit.view") ? <Link href={`/audit?user=${u.id}`} className="text-sm underline">Full audit log</Link> : undefined}>
        {me.activity.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {me.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  {a.sentence}
                </span>
                <span className="text-muted">{when(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Two-step sign-in: whether it is on, and the setup in progress with its QR code. */
async function TwoStepTab({ userId }: { userId: string }) {
  const u = await requireUser();
  const [status, setup] = await Promise.all([twoStepStatus(userId), pendingSetup(u)]);
  return (
    <Card>
      <TwoStepPanel
        status={{ enabled: status.enabled, enabledOn: status.enabledAt ? when(status.enabledAt) : null, recoveryLeft: status.recoveryLeft }}
        setup={setup ? { grouped: setup.grouped, qr: await qrSvg(setup.otpauth) } : null}
      />
    </Card>
  );
}
