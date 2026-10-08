"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, requireUser, upgradePath } from "@/lib/auth/current";
import { advanceInput, salaryInput, salaryPayInput } from "@/lib/validation/payroll";
import { paySalary, recordAdvance, setSalary } from "@/lib/services/payroll";
import { formatRupees } from "@/lib/format";
import { staffInput } from "@/lib/validation/staff";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { createStaff, setStaffActive, updateStaff } from "@/lib/services/staff";
import { adminResetTwoStep } from "@/lib/services/two-step";
import { UserError } from "@/lib/services/errors";

export async function saveStaff(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("staff.manage");
  const raw = Object.fromEntries([...fd.keys()].filter((k) => k !== "branchIds").map((k) => [k, fd.get(k)]));
  const parsed = staffInput.safeParse({ ...raw, branchIds: fd.getAll("branchIds") });
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  try {
    if (id) await updateStaff(u, id, parsed.data);
    else await createStaff(u, parsed.data);
  } catch (e) {
    if (e instanceof UserError) return failed(fd, { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
    throw e;
  }
  revalidatePath("/staff");
  redirect("/staff");
}

export async function toggleStaff(id: string, active: boolean): Promise<void> {
  const u = await requirePermission("staff.manage");
  try {
    await setStaffActive(u, id, active);
  } catch (e) {
    if (e instanceof UserError) redirect(`/staff?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/staff");
}

const back = (fd: FormData, msg: string) => {
  const tab = String(fd.get("tab") ?? "");
  const month = String(fd.get("month") ?? "");
  const q = new URLSearchParams();
  if (tab === "pay") q.set("tab", "pay");
  if (tab === "pay" && /^\d{4}-\d{2}$/.test(month)) q.set("month", month);
  q.set("ok", msg);
  redirect(`/staff?${q}`);
};
const refuse = (fd: FormData, e: unknown): FormState => {
  if (e instanceof UserError) return failed(fd, { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
  throw e;
};

export async function saveSalary(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  if (!u.can("payroll.manage") && !u.can("staff.manage")) redirect("/dashboard?denied=1");
  if (!u.has("staff")) redirect(upgradePath(u, "staff"));
  const parsed = salaryInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  try {
    await setSalary(u, id, parsed.data);
  } catch (e) {
    return refuse(fd, e);
  }
  revalidatePath("/staff");
  back(fd, "Salary saved");
}

export async function saveAdvance(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("payroll.manage");
  const parsed = advanceInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  try {
    await recordAdvance(u, id, parsed.data);
  } catch (e) {
    return refuse(fd, e);
  }
  revalidatePath("/staff");
  back(fd, "Advance recorded. It will be deducted at the next salary.");
}

export async function savePayment(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("payroll.manage");
  const parsed = salaryPayInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  let msg: string;
  try {
    const r = await paySalary(u, id, parsed.data);
    msg = `Salary paid to ${r.name} · ${formatRupees(r.row.net)} added to expenses`;
  } catch (e) {
    return refuse(fd, e);
  }
  revalidatePath("/staff");
  back(fd, msg);
}

/** For someone who lost their phone and their recovery codes: turns their two-step sign-in off and signs them out everywhere. */
export async function resetStaffTwoStep(id: string): Promise<void> {
  const u = await requirePermission("staff.manage");
  try {
    await adminResetTwoStep(u, id);
  } catch (e) {
    if (e instanceof UserError) redirect(`/staff?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/staff");
  redirect(`/staff?ok=${encodeURIComponent("Two-step sign-in turned off. They are signed out and can set it up again in My profile.")}`);
}
