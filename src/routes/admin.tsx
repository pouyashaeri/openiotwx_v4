import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CopyBlock, Notice, StatusDot, btnGhost } from "@/components/platform-ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  adminDatabase,
  adminEditStation,
  adminOverview,
  adminTableRows,
  adminUserAction,
  adminUserDetail,
  adminStations,
  adminUsers,
  getMe,
  newKey,
  removeStation,
} from "@/lib/platform/api";
import { ago, useAsync } from "@/lib/platform/hooks";
import { cn } from "@/lib/utils";
import { confirmDialog } from "@/components/confirm-dialog";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — OpenIoTwx" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AdminEntry,
});

/** Staff sign in on their own page; everyone else sees an ordinary "not found". */
function AdminEntry() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return null;
  if (!user) return <Navigate to="/admin/login" search={{ denied: false }} />;
  return <AdminGate />;
}

function NotFoundPage() {
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-4xl">Page not found</h1>
      <p className="mt-3 text-muted">There is nothing at this address.</p>
      <Link to="/" className={`${btnGhost} mt-6`}>
        Go home
      </Link>
    </main>
  );
}

type Tab = "overview" | "stations" | "users" | "database";

function AdminGate() {
  const me = useAsync(() => getMe(), []);
  const [tab, setTab] = useState<Tab>("overview");
  if (me.loading) return <p className="mx-auto max-w-5xl px-4 py-16 text-muted">Checking access…</p>;
  if (!me.data || me.data.role === "user") return <NotFoundPage />;
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-sm text-kelp-deep">
        {me.data.role === "superadmin" ? "Super-admin console" : "Admin console"}
      </p>
      <h1 className="mt-1 font-display text-4xl">Network operations</h1>
      <div className="mt-5 flex gap-1 border-b border-line" role="tablist">
        {(["overview", "stations", "users", "database"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "min-h-11 px-4 text-sm capitalize",
              tab === t ? "border-b-2 border-kelp font-medium text-kelp" : "text-muted",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "overview" ? <Overview /> : tab === "stations" ? <Stations /> : tab === "database" ? <Database /> : <Users me={me.data} />}
      </div>
    </main>
  );
}

const nf = new Intl.NumberFormat();

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{typeof value === "number" ? nf.format(value) : value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Overview() {
  const { data, error } = useAsync(() => adminOverview(), [], 5000);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const i = data.ingest;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stations" value={data.stations} hint={`${data.active} active · ${data.online} online now`} />
        <Stat label="People" value={data.users} hint={`${data.plans} saved plans`} />
        <Stat label="Readings, last 24 h" value={data.rows_24h} hint={`${nf.format(data.rows_total)} stored in total`} />
        <Stat
          label="Storage engine"
          value={data.timescale ? "TimescaleDB" : "Postgres"}
          hint={data.timescale ? "Hypertable, compression, hourly rollups" : "Plain tables. Use the Docker stack for big data."}
        />
      </div>
      <section>
        <h2 className="font-display text-xl">Ingest on this server</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Accepted" value={i.accepted} hint={`${nf.format(i.rejected)} values rejected`} />
          <Stat label="Written to database" value={i.flushed} hint={`${nf.format(i.flushes)} batches`} />
          <Stat label="Waiting in buffer" value={i.buffered} hint={`limit ${nf.format(i.maxBuffer)}`} />
          <Stat label="Pushed back" value={i.limited + i.shed} hint={`${i.limited} rate-limited · ${i.shed} shed`} />
        </div>
        {i.errors ? <div className="mt-3"><Notice>{i.errors} database write failures. Last: {i.lastError}</Notice></div> : null}
      </section>
      <section>
        <h2 className="font-display text-xl">Recent activity</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
          {data.audit.length ? (
            data.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm">
                <span className="font-mono text-xs">{a.action}</span>
                <span className="text-muted">{ago(a.at)}</span>
              </li>
            ))
          ) : (
            <li className="px-4 py-3 text-sm text-muted">Nothing yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Stations() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "disabled">("");
  const [offset, setOffset] = useState(0);
  const [key, setKey] = useState<{ name: string; key: string } | null>(null);
  const list = useAsync(() => adminStations({ data: { q, status, offset } }), [q, status, offset], 15000);

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast.success(done);
      void list.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          placeholder="Search name, id or owner email"
          aria-label="Search stations"
          className="min-h-11 flex-1 rounded-full border border-line bg-card px-4 text-sm"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setOffset(0);
          }}
          aria-label="Filter by status"
          className="min-h-11 rounded-full border border-line bg-card px-4 text-sm"
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>
      {list.error ? <div className="mt-3"><Notice>{list.error}</Notice></div> : null}
      {key ? (
        <div className="mt-4 rounded-2xl border border-copper bg-card p-4">
          <p className="text-sm">New key for {key.name}. Shown once.</p>
          <CopyBlock label="API key" text={key.key} />
        </div>
      ) : null}
      <ul className="mt-4 grid gap-2">
        {list.data?.map((s) => (
          <li key={s.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link to="/stations/$slug" params={{ slug: s.slug }} className="font-medium text-kelp">
                  {s.name}
                </Link>
                <p className="truncate text-xs text-muted">
                  {s.owner_email ?? s.owner_id} · {s.slug}
                </p>
              </div>
              <StatusDot station={s} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2 text-muted">
                Uploads/min
                <input
                  type="number"
                  min={1}
                  max={100000}
                  defaultValue={s.rate_limit_per_min}
                  className="min-h-9 w-24 rounded-lg border border-line bg-paper px-2 text-ink"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v && v !== s.rate_limit_per_min)
                      void act(() => adminEditStation({ data: { id: s.id, rateLimitPerMin: v } }), "Limit updated");
                  }}
                />
              </label>
              <button
                className={btnGhost}
                onClick={() =>
                  act(
                    () => adminEditStation({ data: { id: s.id, status: s.status === "active" ? "disabled" : "active" } }),
                    s.status === "active" ? "Disabled" : "Enabled",
                  )
                }
              >
                {s.status === "active" ? "Disable" : "Enable"}
              </button>
              <button
                className={btnGhost}
                onClick={async () => {
                  if (!(await confirmDialog({ title: "Make a new key?", message: `The old key for ${s.name} stops working immediately.`, confirmLabel: "Make new key" }))) return;
                  const k = await newKey({ data: { id: s.id } }).catch((e: Error) => (toast.error(e.message), null));
                  if (k) setKey({ name: s.name, key: k });
                }}
              >
                New key
              </button>
              <button
                className={btnGhost}
                onClick={async () => {
                  if (await confirmDialog({ title: "Delete this station?", message: `${s.name} and all its data will be deleted. This can't be undone.`, confirmLabel: "Delete station", danger: true }))
                    void act(() => removeStation({ data: { id: s.id } }), "Deleted");
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {list.data && !list.data.length ? <p className="mt-4 text-muted">No stations match.</p> : null}
      <div className="mt-4 flex justify-between">
        <button className={btnGhost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
          Previous
        </button>
        <button className={btnGhost} disabled={(list.data?.length ?? 0) < 50} onClick={() => setOffset(offset + 50)}>
          Next
        </button>
      </div>
    </div>
  );
}

type Me = { userId: string; role: "user" | "admin" | "superadmin" };
type Action = Parameters<typeof adminUserAction>[0]["data"]["action"];
type RunUser = { user_id: string; email: string };
type Run = (u: RunUser, action: Action, confirmText?: string) => Promise<void>;

function Users({ me }: { me: Me }) {
  const list = useAsync(() => adminUsers(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);

  const run: Run = async (u, action, confirmText) => {
    if (confirmText && !(await confirmDialog({ title: "Are you sure?", message: confirmText, confirmLabel: "Yes, continue", danger: action === "delete" }))) return;
    try {
      const r = await adminUserAction({ data: { userId: u.user_id, action } });
      if (r.tempPassword) setTemp({ email: u.email, password: r.tempPassword });
      else toast.success("Done");
      if (action === "delete") setOpen(null);
      void list.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    }
  };

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        {me.role === "superadmin"
          ? "As a super-admin you can manage everyone except other super-admins, and you decide who is an administrator."
          : "You can manage regular accounts. Only a super-admin can manage administrators."}
      </p>
      {list.error ? <Notice>{list.error}</Notice> : null}
      {temp ? (
        <div className="mb-4 rounded-2xl border border-copper bg-card p-4">
          <p className="text-sm">
            New temporary password for {temp.email}. Shown once. They are signed out everywhere.
          </p>
          <CopyBlock label="Temporary password" text={temp.password} />
          <button className={`${btnGhost} mt-3`} onClick={() => setTemp(null)}>
            Done
          </button>
        </div>
      ) : null}
      <ul className="grid gap-2">
        {list.data?.map((u) => {
          const mine = u.user_id === me.userId;
          const canManage = !mine && u.role !== "superadmin" && (u.role === "user" || me.role === "superadmin");
          return (
            <li key={u.user_id} className="rounded-2xl border border-line bg-card px-4 py-3">
              <button
                type="button"
                className="block w-full min-w-0 text-left"
                onClick={() => setOpen(open === u.user_id ? null : u.user_id)}
                aria-expanded={open === u.user_id}
              >
                <p className="truncate font-medium">
                  {u.name || u.email}
                  {u.role !== "user" ? (
                    <span className="ml-2 rounded-full bg-moss px-2 py-0.5 text-xs text-kelp-deep">
                      {u.role === "superadmin" ? "super-admin" : "admin"}
                    </span>
                  ) : null}
                  {u.suspended ? (
                    <span className="ml-2 rounded-full border border-copper px-2 py-0.5 text-xs">suspended</span>
                  ) : null}
                  {mine ? <span className="ml-2 text-xs text-muted">you</span> : null}
                </p>
                <p className="truncate text-xs text-muted">
                  {u.email} · {u.stations} stations · {u.plans} plans · joined {ago(u.created_at)}
                </p>
              </button>
              {open === u.user_id ? (
                <UserPanel user={u} canManage={canManage} isSuper={me.role === "superadmin"} run={run} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UserPanel({
  user,
  canManage,
  isSuper,
  run,
}: {
  user: { user_id: string; email: string; role: "user" | "admin" | "superadmin"; suspended: boolean };
  canManage: boolean;
  isSuper: boolean;
  run: Run;
}) {
  const detail = useAsync(() => adminUserDetail({ data: { userId: user.user_id } }), [user.user_id]);
  const d = detail.data;
  return (
    <div className="mt-3 border-t border-line pt-3 text-sm">
      {d ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted">Stations</p>
            {d.stations.length ? (
              <ul className="mt-1 grid gap-1">
                {d.stations.map((s) => (
                  <li key={s.slug}>
                    <Link to="/stations/$slug" params={{ slug: s.slug }} className="text-kelp">
                      {s.name}
                    </Link>{" "}
                    <span className="text-xs text-muted">
                      {s.status === "disabled" ? "disabled · " : ""}heard {ago(s.last_seen_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted">Saved plans</p>
            {d.plans.length ? (
              <ul className="mt-1 grid gap-1">
                {d.plans.map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None</p>
            )}
            <p className="mt-2 text-xs text-muted">
              {d.activeSessions} active sign-in{d.activeSessions === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-muted">Loading…</p>
      )}
      {canManage ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => run(user, user.suspended ? "restore" : "suspend")}>
            {user.suspended ? "Restore access" : "Suspend"}
          </button>
          <button
            className={btnGhost}
            onClick={() => run(user, "revoke_sessions", `Sign ${user.email} out everywhere?`)}
          >
            Sign out everywhere
          </button>
          <button
            className={btnGhost}
            onClick={() =>
              run(user, "reset_password", `Set a new temporary password for ${user.email}? They will be signed out.`)
            }
          >
            Reset password
          </button>
          {isSuper ? (
            <button className={btnGhost} onClick={() => run(user, user.role === "admin" ? "remove_admin" : "make_admin")}>
              {user.role === "admin" ? "Remove admin" : "Make admin"}
            </button>
          ) : null}
          <button
            className={btnGhost}
            onClick={() =>
              run(user, "delete", `Delete ${user.email} with all their stations, data and plans? This cannot be undone.`)
            }
          >
            Delete account
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">
          {user.role === "superadmin"
            ? "Super-admins are set in the server configuration."
            : "You cannot change this account."}
        </p>
      )}
    </div>
  );
}

const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);

/** What pgAdmin was for in the legacy stack: how big the database is, and a look at each table. */
function Database() {
  const info = useAsync(() => adminDatabase(), [], 30000);
  const [table, setTable] = useState("stations");
  const [offset, setOffset] = useState(0);
  const rows = useAsync(() => adminTableRows({ data: { table, offset } }), [table, offset]);
  const d = info.data;

  function csv() {
    if (!rows.data) return;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const text = [rows.data.columns.join(","), ...rows.data.rows.map((r) => rows.data!.columns.map((c) => esc(r[c] ?? "")).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `${table}-${offset / 50 + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      {info.error ? <Notice>{info.error}</Notice> : null}
      {d ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Database size" value={bytes(d.bytes)} hint={d.version.split(",")[0]} />
          <Stat label="Readings from" value={d.first ? new Date(d.first).toLocaleDateString() : "—"} />
          <Stat label="Latest reading" value={d.last ? ago(d.last) : "—"} />
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 md:grid-cols-[14rem_1fr]">
        <ul className="rounded-2xl border border-line bg-card" aria-label="Tables">
          {d?.tables.map((t) => (
            <li key={t.name}>
              <button
                className={cn("flex min-h-11 w-full items-center justify-between px-3 text-sm", table === t.name && "bg-moss font-medium text-kelp")}
                onClick={() => {
                  setTable(t.name);
                  setOffset(0);
                }}
              >
                <span>{t.name}</span>
                <span className="tabular-nums text-muted">{nf.format(t.rows)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl">{table}</h2>
            <span className="text-sm text-muted">newest first · secret columns are never shown</span>
            <button className={cn(btnGhost, "ml-auto")} onClick={csv} disabled={!rows.data?.rows.length}>
              Download this page (CSV)
            </button>
          </div>
          {rows.error ? <p className="mt-2 text-sm text-copper">{rows.error}</p> : null}
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  {rows.data?.columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data?.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {rows.data!.columns.map((c) => (
                      <td key={c} className="max-w-[16rem] truncate whitespace-nowrap px-3 py-2">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.data && rows.data.rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-muted">No rows.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <button className={btnGhost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
              Newer
            </button>
            <button className={btnGhost} disabled={!rows.data || rows.data.rows.length < 50} onClick={() => setOffset(offset + 50)}>
              Older
            </button>
          </div>
        </div>
      </div>
      <p className="mt-5 text-sm text-muted">
        Row-level changes happen through the Stations and Users tabs so
        every change is recorded in the audit log.
      </p>
    </div>
  );
}
