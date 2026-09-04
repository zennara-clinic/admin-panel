/**
 * Contact change requests (email / mobile).
 *
 * Customers change their own email or phone through a verified, delayed flow in
 * the app; the change applies automatically a few hours later — no staff action.
 * This page is a read-only record for support and audit.
 */
import { useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { CLINIC_TZ } from "../lib/format";
import { Page, Async, DataTable, Tag, Note, Sel, Empty } from "../ui";

const FILTERS = ["All", "Scheduled", "Applied", "Verifying", "Cancelled", "Failed"];
const LABEL_TO_STATUS: Record<string, string> = {
  Scheduled: "scheduled",
  Applied: "applied",
  Verifying: "awaiting_verification",
  Cancelled: "cancelled",
  Failed: "failed",
};
const STATUS_TONE: Record<string, "ok" | "warn" | "info" | "err" | "mute"> = {
  applied: "ok",
  scheduled: "info",
  verified: "info",
  awaiting_verification: "warn",
  cancelled: "mute",
  failed: "err",
};
const STATUS_LABEL: Record<string, string> = {
  awaiting_verification: "Verifying",
  verified: "Verified",
  scheduled: "Scheduled",
  applied: "Applied",
  cancelled: "Cancelled",
  failed: "Failed",
};

function fmt(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { timeZone: CLINIC_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ContactChanges() {
  const [filter, setFilter] = useState("All");
  const status = LABEL_TO_STATUS[filter];
  const q = useApi(() => api.contactChange.list(status ? { status } : undefined), [status]);

  return (
    <Page
      title="Contact change requests"
      sub="Customer email & mobile changes — verified in the app and applied automatically."
    >
      <Note kind="gold" className="mb-4">
        These are handled automatically: once a customer verifies their current contact, the change
        applies a few hours later. This view is read-only — for support and audit.
      </Note>

      <div className="mb-4 max-w-[220px]">
        <Sel label="Status" value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      <Async q={q} label="Loading requests…">
        {(rows) =>
          rows.length ? (
            <DataTable
              cols={["Customer", "Change", "From", "To", "Status", "When", "Requested"]}
              rows={rows.map((r) => [
                r.customer?.fullName || "—",
                r.type === "email" ? "Email" : "Mobile",
                r.from || "—",
                r.to || "—",
                <Tag key={r.id} kind={STATUS_TONE[r.status] || "mute"}>
                  {STATUS_LABEL[r.status] || r.status}
                </Tag>,
                r.status === "applied" ? fmt(r.appliedAt) : r.status === "scheduled" ? fmt(r.scheduledApplyAt) : "—",
                fmt(r.createdAt),
              ])}
            />
          ) : (
            <Empty title="No contact change requests" hint="Email / mobile change requests from the app will appear here." />
          )
        }
      </Async>
    </Page>
  );
}
