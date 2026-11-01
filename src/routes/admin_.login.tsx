import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient, signOut } from "@/lib/auth/client";
import { getMe } from "@/lib/platform/api";

/**
 * Staff sign-in. It is not linked from anywhere in the site and is kept out of
 * search engines; the address is the only way in. A correct password for an
 * account that is not staff is treated exactly like a wrong one.
 */
export const Route = createFileRoute("/admin_/login")({
  head: () => ({
    meta: [{ title: "Staff sign in" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  validateSearch: (q: Record<string, unknown>) => ({ denied: q.denied === 1 || q.denied === "1" || q.denied === true }),
  component: AdminLogin,
});

const DENIED = "Those details don't match a staff account.";

function AdminLogin() {
  const navigate = useNavigate();
  const { denied } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(denied ? DENIED : null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setError(null);
    if (!email || !password) return setError(DENIED);
    setBusy(true);
    const res = await authClient.signIn.email({ email, password });
    if (res.error) {
      setBusy(false);
      return setError(DENIED);
    }
    const me = await getMe().catch(() => null);
    if (!me || me.role === "user") {
      // Not staff: undo the sign-in so this page can't be used as a back door to a normal session.
      await signOut("/admin/login?denied=1").catch(() => setBusy(false));
      return;
    }
    void navigate({ to: "/admin" });
  }

  return (
    <main id="content" className="mx-auto grid max-w-sm px-4 py-20">
      <p className="text-sm text-kelp-deep">Staff only</p>
      <h1 className="mt-1 font-display text-3xl">Sign in to operations</h1>
      <form method="post" onSubmit={submit} noValidate className="mt-6 grid gap-4 rounded-2xl border border-line bg-card p-5">
        <label className="grid gap-1 text-sm">
          Email
          <input name="email" type="email" autoComplete="username" className="min-h-11 rounded-xl border border-line bg-paper px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          Password
          <input name="password" type="password" autoComplete="current-password" className="min-h-11 rounded-xl border border-line bg-paper px-3" />
        </label>
        {error ? (
          <p role="alert" className="rounded-xl border border-copper px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className="min-h-12 rounded-full bg-kelp px-5 text-sm font-medium text-paper disabled:opacity-60 transition-[filter] duration-150 not-disabled:hover:brightness-110">
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
