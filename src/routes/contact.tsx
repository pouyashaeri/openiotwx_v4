import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { btnGhost, btnPrimary } from "@/components/platform-ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { LIMITS, SUPPORT_TOPICS, TOPIC_IDS, supportMailto, validateSupport, type SupportInput } from "@/lib/support/info";
import { sendSupport, supportInfo } from "@/lib/support/api";
import { useAsync } from "@/lib/platform/hooks";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact and support | OpenIoTwx" }] }),
  // The chat and other pages link here with ?topic=…&message=…&from=… so nobody has to retype what they said.
  validateSearch: (s: Record<string, unknown>): { topic?: string; message?: string; from?: string } => ({
    topic: typeof s.topic === "string" && TOPIC_IDS.includes(s.topic) ? s.topic : undefined,
    message: typeof s.message === "string" ? s.message.slice(0, LIMITS.messageMax) : undefined,
    from: typeof s.from === "string" ? s.from.slice(0, LIMITS.page) : undefined,
  }),
  component: ContactPage,
});

const field = "min-h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm";

function ContactPage() {
  const search = Route.useSearch();
  const { user } = useCurrentUserState();
  const info = useAsync(() => supportInfo(), []);
  const email = info.data?.email ?? null;

  const [form, setForm] = useState<SupportInput>({ name: "", email: "", topic: search.topic ?? "", message: search.message ?? "" });
  const [website, setWebsite] = useState(""); // the hidden field: only a robot fills it
  const [errors, setErrors] = useState<Partial<Record<keyof SupportInput | "form", string>>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ to: string; emailed: boolean } | null>(null);

  // A signed-in person does not retype who they are.
  useEffect(() => {
    if (!user || user.isDevFallback) return;
    setForm((f) => ({ ...f, name: f.name || user.displayName || "", email: f.email || user.primaryEmail || "" }));
  }, [user]);

  const set = (k: keyof SupportInput) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined, form: undefined }));
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The browser's own pop-ups look like nothing else on the site, so the form checks itself and answers in the site's words.
    const problem = validateSupport(form);
    if (problem) {
      setErrors({ [problem.field]: problem.message });
      document.getElementById(`contact-${problem.field}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const from = search.from || (document.referrer && new URL(document.referrer).origin === window.location.origin ? new URL(document.referrer).pathname : "");
      const r = await sendSupport({ data: { ...form, page: from, website } });
      setSent({ to: form.email.trim(), emailed: r.emailed });
    } catch (err) {
      const message = err instanceof Error ? err.message : "That did not send. Please try again.";
      setErrors({ form: message });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-4xl sm:text-5xl">Contact and support</h1>
      <p className="mt-3 max-w-3xl text-muted">
        Planning a station, a station that will not report, data and GDEX, your account, or something else: tell us and a person will answer.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {sent ? (
          <section role="status" className="rounded-2xl border border-line bg-card p-6" aria-labelledby="contact-done">
            <h2 id="contact-done" className="font-display text-2xl">
              Thanks, we got it.
            </h2>
            <p className="mt-2 text-sm text-muted">
              A reply goes to <strong className="text-ink">{sent.to}</strong>. {email ? "" : "We read every message that arrives here."}
            </p>
            {!sent.emailed && email ? (
              <p className="mt-2 text-sm text-muted">
                Your message is saved with the team. If you do not hear back in a few days, write to{" "}
                <a className="text-kelp underline underline-offset-4" href={supportMailto(email)}>
                  {email}
                </a>
                .
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/" className={btnGhost}>
                Back to the home page
              </Link>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setSent(null);
                  setForm((f) => ({ ...f, message: "" }));
                }}
              >
                Send another message
              </button>
            </div>
          </section>
        ) : (
          <form method="post" onSubmit={submit} noValidate className="grid gap-4 rounded-2xl border border-line bg-card p-5" aria-label="Contact form">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid content-start gap-1 text-sm">
                Your name
                <input id="contact-name" name="name" autoComplete="name" value={form.name} onChange={set("name")} aria-invalid={Boolean(errors.name)} className={cn(field, errors.name && "border-copper")} />
                {errors.name ? <span role="alert" className="text-xs text-copper">{errors.name}</span> : null}
              </label>
              <label className="grid content-start gap-1 text-sm">
                Your email
                <input id="contact-email" name="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} aria-invalid={Boolean(errors.email)} className={cn(field, errors.email && "border-copper")} />
                {errors.email ? <span role="alert" className="text-xs text-copper">{errors.email}</span> : <span className="text-xs text-muted">Where our reply goes. Nobody else sees it.</span>}
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              What is it about?
              <select id="contact-topic" name="topic" value={form.topic} onChange={set("topic")} aria-invalid={Boolean(errors.topic)} className={cn(field, errors.topic && "border-copper")}>
                <option value="">Choose one…</option>
                {SUPPORT_TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {errors.topic ? <span role="alert" className="text-xs text-copper">{errors.topic}</span> : null}
            </label>
            <label className="grid gap-1 text-sm">
              Your message
              <textarea
                id="contact-message"
                name="message"
                rows={7}
                value={form.message}
                onChange={set("message")}
                aria-invalid={Boolean(errors.message)}
                placeholder="What are you trying to do, and what is in the way? Station name, what you see, and what you tried help us answer faster."
                className={cn(field, "py-2", errors.message && "border-copper")}
              />
              {errors.message ? <span role="alert" className="text-xs text-copper">{errors.message}</span> : null}
            </label>
            {/* A trap for robots: hidden from people and from screen readers. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Leave this empty
                <input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            {errors.form ? (
              <p role="alert" className="rounded-xl border border-copper px-3 py-2 text-sm">
                {errors.form}
              </p>
            ) : null}
            <div>
              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? "Sending…" : "Send message"}
              </button>
            </div>
          </form>
        )}

        <aside className="grid content-start gap-4 text-sm">
          <section className="rounded-2xl border border-line bg-paper-deep p-5">
            <h2 className="font-display text-xl">{email ? "Prefer email?" : "Find us"}</h2>
            {email ? (
              <p className="mt-2 text-muted">
                Write to{" "}
                <a className="text-kelp underline underline-offset-4" href={supportMailto(email)}>
                  {email}
                </a>
                . It reaches the same people as this form.
              </p>
            ) : null}
            <address className="mt-2 not-italic text-muted">
              <strong className="text-ink">NCAR Mesa Lab</strong>
              <br />
              1850 Table Mesa Drive
              <br />
              Boulder, CO 80305
            </address>
          </section>
          <section className="rounded-2xl border border-line bg-paper-deep p-5">
            <h2 className="font-display text-xl">Before you write</h2>
            <ul className="mt-2 grid gap-2 text-muted">
              <li>
                Planning questions: the{" "}
                <Link to="/wizard" className="text-kelp underline underline-offset-4">
                  wizard
                </Link>{" "}
                and the chat on every page can walk you through it.
              </li>
              <li>
                Data and the archive:{" "}
                <Link to="/gdex" className="text-kelp underline underline-offset-4">
                  how data reaches GDEX
                </Link>
                .
              </li>
              <li>
                Flashing and wiring:{" "}
                <Link to="/library" className="text-kelp underline underline-offset-4">
                  the library
                </Link>
                .
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
