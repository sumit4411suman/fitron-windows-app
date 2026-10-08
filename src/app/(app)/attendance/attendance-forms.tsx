"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowRightIcon, ArrowsClockwiseIcon, CameraIcon, CameraSlashIcon, CheckCircleIcon, FingerprintIcon, HandCoinsIcon, PrinterIcon, SignInIcon, SignOutIcon, SnowflakeIcon, XIcon } from "@phosphor-icons/react";
import type { DeskHit } from "@/lib/services/attendance";
import { Button, Field, Input, Notice, Select, cx } from "@/components/ui";
import { checkOutAction, deskCheckInAction, guestAction, searchAction, type DeskResult } from "./actions";

type Block = Extract<DeskResult, { blocked: string }>;
type Done = Extract<DeskResult, { ok: true }>;
type Device = { name: string; online: boolean; sync: string };

const btn = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border px-[18px] text-sm font-semibold whitespace-nowrap disabled:opacity-45";
const primary = `${btn} border-transparent bg-accent text-accent-ink hover:bg-accent-hover`;
const secondary = `${btn} border-line hover:bg-fg/7`;
const ghost = `${btn} border-transparent px-1.5 text-accent hover:bg-accent/10`;
const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

/** The check-in panel (prototype ATTENDANCE): Front desk / QR code / Biometric, with the door rules applied. */
export function CheckInDesk({ rulesText, qr, qrText, gymName, branchName, devices, canOverride }: { rulesText: string; qr: string; qrText: string; gymName: string; branchName: string; devices: Device[]; canOverride: boolean }) {
  const [mode, setMode] = useState<"Manual" | "QR" | "Biometric">("Manual");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DeskHit[]>([]);
  const [block, setBlock] = useState<Block | null>(null);
  const [last, setLast] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2 || block) return;
    const t = setTimeout(() => searchAction(q).then(setHits), 200);
    return () => clearTimeout(t);
  }, [q, block]);

  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), 15000);
    return () => clearTimeout(t);
  }, [last]);

  const run = (input: { memberId?: string; override?: boolean; method?: string; q?: string }) =>
    start(async () => {
      setError(null);
      const r = await deskCheckInAction({ ...input, q: input.q ?? q, method: input.method ?? (mode === "QR" ? "QR" : "Manual") });
      if (r.ok) {
        setLast(r);
        setBlock(null);
        setQ("");
        setHits([]);
      } else if ("blocked" in r) setBlock(r);
      else if ("error" in r) setError(r.error);
      else if ("pick" in r) searchAction(q).then(setHits);
    });

  const box = (placeholder: string, big = false, label = "Check in") => (
    <div className="flex gap-2.5">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setBlock(null);
          setError(null);
          if (e.target.value.trim().length < 2) setHits([]);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") run({});
          if (e.key === "Escape") {
            setQ("");
            setBlock(null);
            setHits([]);
          }
        }}
        placeholder={placeholder}
        aria-label="Find member"
        autoComplete="off"
        className={cx("w-full rounded-md border border-line bg-surface text-fg placeholder:text-fg/65 hover:border-fg/45 focus:border-accent focus:outline-none", big ? "px-3.5 py-3 text-base" : "min-h-9 px-2.5 py-1.5")}
      />
      <button type="button" onClick={() => run({})} disabled={pending || !q.trim()} className={big ? `${primary} px-[18px]` : secondary}>
        {big && <SignInIcon weight="duotone" />}
        {label}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex self-start overflow-hidden rounded-md border border-line">
        {(
          [
            ["Manual", "Front desk"],
            ["QR", "QR code"],
            ["Biometric", "Biometric"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={cx("px-3.5 py-[7px] text-[13px] leading-[normal]", mode === k ? "bg-accent text-accent-ink" : "hover:bg-fg/7")}>
            {l}
          </button>
        ))}
      </div>

      {mode === "Manual" && (
        <>
          <div className="relative">
            {box("Name, member ID, mobile or card number", true)}
            {hits.length > 0 && !block && (
              <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-10 overflow-hidden rounded-xl border border-line bg-bg shadow-lg">
                {hits.map((h) => (
                  <button key={h.id} type="button" onClick={() => run({ memberId: h.id })} className="flex w-full items-center gap-3 border-b border-fg/8 px-3.5 py-2.5 text-left hover:bg-accent-soft">
                    <span className="grid size-[34px] flex-none place-items-center rounded-full bg-accent-soft text-[12.5px] font-bold text-accent-strong">
                      {h.name
                        .split(" ")
                        .map((x) => x[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {h.name}{" "}
                        <span className="text-xs font-normal text-muted">
                          {h.code} · {h.phone}
                        </span>
                      </span>
                      <span className={cx("block text-[12.5px]", h.tone === "inside" ? "text-accent-700" : h.tone === "blocked" ? "text-alert-700" : "text-muted")}>
                        {h.planName ?? "No plan"} · {h.status}
                      </span>
                    </span>
                    <ArrowRightIcon weight="duotone" className="text-accent" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="text-[12.5px] text-muted">Type at least two letters of the name, the member ID, mobile or card number, then press Enter. Rules: {rulesText}.</div>
        </>
      )}

      {mode === "QR" && (
        <>
          <div className="grid grid-cols-[auto_1fr] items-start gap-[18px] rounded-[14px] border border-line bg-surface p-[18px]">
            <div id="qr-poster" className="rounded-[10px] bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
              <img src={qr} alt="Check-in QR code" width={150} height={150} />
              <div className="mt-1.5 text-center text-[11px] font-semibold text-[#444]">
                {gymName}
                <br />
                Scan to check in
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2.5">
              <div className="text-base font-semibold">Front-desk QR poster</div>
              <div className="text-[13.5px] leading-[1.55] text-muted">
                Members scan this with their phone camera; it opens their Fitron check-in page for {branchName}. Print it and keep it at the entrance.
              </div>
              <div className="text-xs break-all text-faint">{qrText}</div>
              <div>
                <button type="button" onClick={() => window.print()} className={secondary}>
                  <PrinterIcon weight="duotone" />
                  Print poster
                </button>
              </div>
            </div>
          </div>
          <QrScanner
            onCode={(code) => {
              setQ(code);
              run({ q: code, method: "QR" });
            }}
            box={box("Or type the member ID from the card")}
          />
        </>
      )}

      {mode === "Biometric" && (
        <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-[18px]">
          <div className="text-base font-semibold">Devices at this branch</div>
          {devices.map((d) => (
            <div key={d.name} className="flex justify-between gap-3 border-b border-fg/8 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <span className={cx("size-2 rounded-full", d.online ? "bg-[#2e9e63]" : "bg-alert-700")} />
                {d.name}
              </span>
              <span className="text-[12.5px] text-muted">
                {d.online ? "Online" : "Offline"} · {d.sync}
              </span>
            </div>
          ))}
          {devices.length === 0 && <div className="text-sm text-muted">No door devices at this branch yet.</div>}
          <div className="text-[13px] leading-[1.55] text-muted">Face, fingerprint and card punches from these devices are checked against the access rules and appear in the list below automatically. Check-out happens on the second punch.</div>
          <div>
            <Link href="/settings/devices" className={secondary}>
              <FingerprintIcon weight="duotone" />
              Devices, enrolment &amp; access log
            </Link>
          </div>
          {box("Device offline? Type name or ID to check in by hand")}
        </div>
      )}

      {error && <Notice tone="alert">{error}</Notice>}

      {block && (
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-alert-300 bg-alert-soft px-[18px] py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] tracking-[0.1em] text-alert-strong uppercase">Stopped at the door</div>
              <div className="mt-0.5 text-lg font-semibold">{block.name}</div>
              <div className="mt-0.5 text-sm text-alert-strong">{block.blocked}</div>
            </div>
            <button type="button" onClick={() => setBlock(null)} className="grid size-9 place-items-center rounded-md hover:bg-fg/7" aria-label="Close">
              <XIcon weight="duotone" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {block.kind === "expired" && (
              <Link href={`/members/${block.memberId}/sell`} className={primary}>
                <ArrowsClockwiseIcon weight="duotone" />
                Renew now
              </Link>
            )}
            {block.kind === "dues" && (
              <Link href={`/members/${block.memberId}?tab=invoices`} className={primary}>
                <HandCoinsIcon weight="duotone" />
                Collect dues
              </Link>
            )}
            {block.kind === "frozen" && (
              <Link href={`/members/${block.memberId}`} className={primary}>
                <SnowflakeIcon weight="duotone" />
                Unfreeze from profile
              </Link>
            )}
            {block.kind === "inside" && block.attendanceId && (
              <button
                type="button"
                className={primary}
                onClick={() =>
                  start(async () => {
                    await checkOutAction(block.attendanceId!);
                    setBlock(null);
                    setQ("");
                  })
                }
              >
                <SignOutIcon weight="duotone" />
                Check out instead
              </button>
            )}
            <Link href={`/members/${block.memberId}`} className={secondary}>
              Open profile
            </Link>
            {block.kind !== "inside" && canOverride && (
              <button type="button" disabled={pending} onClick={() => run({ memberId: block.memberId, override: true })} className={`${ghost} text-alert-strong`}>
                Allow anyway (logged)
              </button>
            )}
          </div>
        </div>
      )}

      {last && !block && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,#2e9e63_40%,transparent)] bg-[color-mix(in_srgb,#2e9e63_16%,var(--bg))] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <CheckCircleIcon size={22} weight="duotone" className="text-[#2e9e63]" />
            <div>
              <div className="font-semibold">{last.name} checked in</div>
              <div className="text-[12.5px] text-muted">
                {last.daysLeft !== null && last.daysLeft >= 0 && last.daysLeft <= 7 ? `Plan ends in ${last.daysLeft} days · ` : ""}
                {last.outstanding > 0 ? `${inr(last.outstanding)} due` : "All clear"}
              </div>
            </div>
          </div>
          <Link href={`/members/${last.memberId}`} className={`${ghost} text-[13px]`}>
            Profile
          </Link>
        </div>
      )}
    </div>
  );
}

/** Reads the QR on a member's card with the device camera (BarcodeDetector), then checks them in by member ID. */
function QrScanner({ onCode, box }: { onCode: (code: string) => void; box: ReactNode }) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  };
  useEffect(() => stop, []);

  const startCam = async () => {
    setErr(null);
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) return setErr("This browser can't read QR codes from the camera. Type the member ID instead, or use Chrome on Android.");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setOn(true);
      requestAnimationFrame(async function tick() {
        const v = video.current;
        if (!stream.current || !v) return;
        if (!v.srcObject) {
          v.srcObject = stream.current;
          await v.play().catch(() => {});
        }
        const found = await new Detector({ formats: ["qr_code"] }).detect(v).catch(() => []);
        const code = found[0]?.rawValue?.trim();
        if (code) {
          stop();
          // Member cards carry the member ID; a link ending in the ID works too.
          onCode(code.split("/").pop() ?? code);
          return;
        }
        requestAnimationFrame(tick);
      });
    } catch {
      setErr("The camera couldn't start. Allow camera access for this site and try again.");
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Scan a member’s QR card</div>
          <div className="text-[13px] text-muted">Uses this device’s camera to read the QR on the member’s card or phone.</div>
        </div>
        {on ? (
          <button type="button" onClick={stop} className={secondary}>
            <CameraSlashIcon weight="duotone" />
            Stop camera
          </button>
        ) : (
          <button type="button" onClick={startCam} className={primary}>
            <CameraIcon weight="duotone" />
            Start camera
          </button>
        )}
      </div>
      {on && (
        <>
          <video ref={video} playsInline muted className="aspect-[4/3] w-full max-w-[420px] rounded-[10px] bg-black object-cover" />
          <div className="text-[12.5px] text-accent-700">Camera on · hold the QR steady in view</div>
        </>
      )}
      {err && <div className="text-[13px] text-alert-700">{err}</div>}
      {box}
    </div>
  );
}

export function GuestForm({ close }: { close: string }) {
  const [state, action, pending] = useActionState(guestAction, undefined);
  const e = state?.errors ?? {};
  const sent = state?.ok ? undefined : (state?.values as Record<string, string> | undefined);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={e.name}>
          <Input name="name" defaultValue={sent?.name} required />
        </Field>
        <Field label="Phone" error={e.phone}>
          <Input name="phone" inputMode="tel" defaultValue={sent?.phone} />
        </Field>
        <Field label="Visit type" className="sm:col-span-2">
          <Select name="visit" defaultValue={sent?.visit ?? "Trial"}>
            <option>Trial</option>
            <option>Guest</option>
            <option>Day pass</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2.5">
        <Link href={close} className={secondary} scroll={false}>
          Close
        </Link>
        <Button variant="primary" disabled={pending}>
          Check in
        </Button>
      </div>
    </form>
  );
}
