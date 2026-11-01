import { useState } from "react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { Notice, btnGhost, btnPrimary } from "@/components/platform-ui";
import { supportAdminDelete, supportAdminList, supportAdminSaveEmail, supportAdminSetStatus } from "@/lib/support/api";
import { SUPPORT_TOPICS, supportMailto } from "@/lib/support/info";
import { ago, useAsync } from "@/lib/platform/hooks";
import { cn } from "@/lib/utils";

const input = "min-h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm";
const topicLabel = (id: string) => SUPPORT_TOPICS.find((t) => t.id === id)?.label ?? id;

/** The support inbox: messages from /contact, newest first, and the address they are emailed to. */
export function SupportAdmin() {
  const inbox = useAsync(() => supportAdminList(), [], 20000);
  const d = inbox.data;
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      await inbox.reload(); // show the new state first, then say it worked
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <div>{inbox.error ? <Notice>{inbox.error}</Notice> : <p className="text-muted">Loading…</p>}</div>;
  const shown = address ?? d.address.email ?? "";
  const source = d.address.source === "admin" ? "set here" : d.address.source === "env" ? "from SUPPORT_EMAIL on the server" : null;

  return (
    <div className="grid gap-8">
      <section aria-labelledby="support-address">
        <h2 id="support-address" className="font-display text-2xl">
          Support email address
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Messages from the contact page are saved here and emailed to this address, with the sender as the reply-to. It is shown on the contact page and in the chat.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 flex-1 basis-64 gap-1 text-sm">
            Address
            <input value={shown} onChange={(e) => setAddress(e.target.value)} placeholder="support@your-domain" className={input} />
          </label>
          <button
            className={btnPrimary}
            disabled={busy || address === null}
            onClick={() => void run(async () => { await supportAdminSaveEmail({ data: { email: shown } }); setAddress(null); }, shown.trim() ? "Saved" : "Cleared")}
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          {d.address.email ? <>Active: {d.address.email} ({source}).</> : <>No address is set, so no address is shown and nothing is emailed. Messages still arrive below.</>}{" "}
          {d.smtp ? "Email sending is configured." : <span className="text-copper">Email sending is not configured (set SMTP_URL on the server), so messages are only kept here.</span>}
        </p>
      </section>

      <section aria-labelledby="support-inbox">
        <h2 id="support-inbox" className="font-display text-2xl">
          Messages{" "}
          <span className={cn("align-middle rounded-full px-2.5 py-0.5 font-sans text-xs", d.newCount ? "bg-kelp text-paper" : "border border-line text-muted")}>{d.newCount} new</span>
        </h2>
        {d.messages.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing yet. Messages sent from the contact page appear here.</p> : null}
        <ul className="mt-3 grid gap-3">
          {d.messages.map((m) => (
            <li key={m.id} className={cn("rounded-2xl border bg-card p-4", m.status === "new" ? "border-kelp" : "border-line")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <strong>{m.name}</strong>{" "}
                  <a className="text-kelp underline underline-offset-4" href={supportMailto(m.email, `Re: ${topicLabel(m.topic)}`)}>
                    {m.email}
                  </a>
                </p>
                <p className="text-xs text-muted" title={new Date(m.created_at).toLocaleString()}>
                  {ago(m.created_at)}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted">
                {topicLabel(m.topic)}
                {m.page ? ` · from ${m.page}` : ""}
                {m.user_id ? " · signed in" : ""}
                {" · "}
                {m.emailed ? "emailed" : <span className="text-copper">not emailed{m.email_error ? `: ${m.email_error}` : ""}</span>}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm">{m.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {m.status === "new" ? (
                  <button className={btnPrimary} disabled={busy} onClick={() => void run(() => supportAdminSetStatus({ data: { id: m.id, status: "handled" } }), "Marked handled")}>
                    Mark handled
                  </button>
                ) : (
                  <button className={btnGhost} disabled={busy} onClick={() => void run(() => supportAdminSetStatus({ data: { id: m.id, status: "new" } }), "Reopened")}>
                    Reopen
                  </button>
                )}
                <a className={btnGhost} href={supportMailto(m.email, `Re: ${topicLabel(m.topic)}`)}>
                  Reply by email
                </a>
                <button
                  className={btnGhost}
                  disabled={busy}
                  onClick={async () => {
                    if (await confirmDialog({ title: "Delete this message?", message: `The message from ${m.name} is deleted for good.`, confirmLabel: "Delete message", danger: true })) {
                      void run(() => supportAdminDelete({ data: { id: m.id } }), "Deleted");
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
