import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — OpenIoTwx" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    // Same-site paths only: "//host" and "/\\host" would be read by browsers as another site.
    next: typeof s.next === "string" && /^\/(?![\\/])/.test(s.next) ? s.next : "/account",
  }),
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim() || email.split("@")[0];
    setError(null);
    // The browser's own pop-ups ("Please lengthen this text…") look like nothing else on the site,
    // so the form checks itself and answers in the site's own message.
    if (mode === "in" && (!email || !password)) {
      setError("Wrong email or password.");
      return;
    }
    if (mode === "up") {
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setError("That email address doesn't look right.");
        return;
      }
      if (password.length < 8) {
        setError("That password is too short. Use 8 characters or more.");
        return;
      }
    }
    setBusy(true);
    const res =
      mode === "up"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });
    if (res.error) {
      setBusy(false);
      // Signing in never says which part was wrong or what the rules are.
      setError(mode === "in" ? "Wrong email or password." : (res.error.message ?? "That didn't work. Check the details and try again."));
      return;
    }
    // Full navigation so every server-rendered surface sees the new session.
    window.location.replace(next);
  }

  return (
    <main id="content" className="mx-auto grid max-w-md px-4 py-14">
      <p className="text-sm text-kelp-deep">Your account</p>
      <h1 className="mt-1 font-display text-4xl">{mode === "in" ? "Sign in" : "Create an account"}</h1>
      <p className="mt-3 text-muted">
        {mode === "in"
          ? "Pick up your plans and stations where you left them."
          : "Save your plan, register your stations, and see their data from any device."}
      </p>
      <form method="post" onSubmit={submit} noValidate className="mt-6 grid gap-4 rounded-2xl border border-line bg-card p-5">
        {mode === "up" ? (
          <label className="grid gap-1 text-sm">
            Name
            <input name="name" autoComplete="name" className="min-h-11 rounded-xl border border-line bg-paper px-3" />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm">
          Email
          <input name="email" type="email" autoComplete="email" className="min-h-11 rounded-xl border border-line bg-paper px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            className="min-h-11 rounded-xl border border-line bg-paper px-3"
          />
          {mode === "up" ? <span className="text-xs text-muted">At least 8 characters.</span> : null}
        </label>
        {error ? (
          <p role="alert" className="rounded-xl border border-copper px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="btn-glow min-h-12 rounded-full bg-kelp px-5 text-sm font-medium text-paper disabled:opacity-60"
        >
          {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        type="button"
        className="mt-4 text-left text-sm text-kelp underline underline-offset-4"
        onClick={() => {
          setMode(mode === "in" ? "up" : "in");
          setError(null);
        }}
      >
        {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
