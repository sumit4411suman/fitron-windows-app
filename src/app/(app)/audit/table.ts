import { listAudit } from "@/lib/services/accounting";

/** The columns shared by the CSV and Excel exports of the audit log. */
export function auditTable(rows: Awaited<ReturnType<typeof listAudit>>["rows"]) {
  return {
    columns: ["ID", "Timestamp", "User", "Role", "Branch", "Module", "Severity", "Action", "Device", "Hash"].map((label) => ({ key: label.toLowerCase(), label })),
    rows: rows.map((r) => ({ id: r.id, timestamp: r.createdAt.toISOString(), user: r.userName, role: r.roleName, branch: r.branchName, module: r.module, severity: r.severity, action: r.sentence, device: r.device, hash: r.hash ?? "" })),
  };
}
