# Contact and support

Anyone can write to the team from **/contact**, signed in or not, about anything: planning a station, a station or flashing problem, data and GDEX, an account, or something else. The message is saved, emailed to the support address, and readable in the admin console.

## How a message travels

1. The visitor fills in the form (name, email, topic, message). The form checks itself and answers in the site's own words; there are no browser pop-ups.
2. The server checks it again, **saves it first** (so nothing is lost if email is down), then tries to email it.
3. The email goes to the support address with the sender as **Reply-To**, so answering it answers the visitor. The subject is `[OpenIoTwx support] <topic>: <first words>`.
4. If email is not set up or sending fails, the message is **still saved**, the visitor still sees "Thanks, we got it", and the admin inbox shows it as not emailed (with the reason).

A signed-in sender is recognised: the form is pre-filled with their name and email, and the message notes that they were signed in. Other pages can link to `/contact?topic=planning&message=...&from=/plan` to pre-fill the topic and message (the chat does this when it cannot help).

## Setting the support address

The address is **not hard-coded anywhere**. With none set, the site shows no address, the form still works, and admins read the messages in the console.

Two ways to set it, the first wins:

- **Admin console, Support tab, "Support email address".** Saved in the database; no redeploy. Clearing it hands back to the environment value.
- **`SUPPORT_EMAIL`** in `.env` (also passed through `docker-compose.yml`).

When set, the address is shown on the contact page (as a mailto link) and anywhere else the site offers email.

## Sending the email (SMTP)

Set one of:

| Setting | Meaning |
|---|---|
| `SMTP_URL` | Everything in one: `smtp://user:password@smtp.example.org:587` (use `smtps://` for port 465). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | The same, separately. `SMTP_SECURE=1` for implicit TLS (the default for port 465). |
| `SUPPORT_FROM` | The From address. Defaults to the SMTP user, or `no-reply@<your site's host>`. |

Use the mail account your institution gives you for this (a service or shared mailbox, not a personal one). Many providers need the From address to be an address that account is allowed to send as. With nothing set, no email is sent and messages are only kept in the console.

## What is stored, and what protects it

- Each message: name, email, topic, text, the page it came from, whether the sender was signed in, when it arrived, and whether it was emailed.
- **IP addresses are never stored.** To slow abuse, the sender's address is turned into a salted hash and kept only as a short code next to the message; the salt is the site's secret, so the code cannot be turned back into an address.
- **Rate limit:** at most 5 messages an hour and 20 a day per sender (per server process). Over the limit, the form says to try again later and shows the support address.
- **Robot trap:** the form has a field people never see. A submission that fills it in looks successful and is thrown away.
- **Header safety:** the name, email and topic are reduced to a single line before they go anywhere near an email header, so nothing can add a recipient or another header.
- Messages are only visible to admins (Support tab). Deleting one removes it for good.

## The admin Support tab

Messages newest first with the count of new ones, the sender (a mailto link), topic, page, whether it was emailed (and the error if not), and the text. Per message: **Mark handled / Reopen**, **Reply by email** (opens your mail program), **Delete** (asks first). Above the list: the support address, where it comes from (this console or `SUPPORT_EMAIL`), and whether email sending is configured.

## Tests

- `src/lib/support/support.test.ts` (unit): validation and its messages, single-line header safety, the composed email, the rate limiter.
- `npm run e2e:support` (browser). It needs a **fresh** server (the first account becomes the super-admin). Two modes:

  ```bash
  # with email: the script runs its own SMTP server and checks what it is sent
  SUPPORT_EMAIL=help@example.test SMTP_URL=smtp://127.0.0.1:2525 npm run dev -- --port 8093
  SMTP_PORT=2525 node scripts/e2e-support.mjs http://localhost:8093

  # without email or an address
  npm run dev -- --port 8093
  node scripts/e2e-support.mjs http://localhost:8093 --no-smtp
  ```

  It checks the recipient, Reply-To, subject and body that arrive, the form's messages, the robot trap, the rate limit, the admin inbox and address override, that a message is still saved and acknowledged with no SMTP, and the phone layout.

What the tests do not cover: delivery through a real mail provider (the test SMTP server accepts anything). Send yourself a message through `/contact` after configuring `SMTP_URL`, and check it arrives.

## Where the code is

| | |
|---|---|
| `migrations/0008_support.sql` | `support_messages` and `site_settings` |
| `src/lib/support/info.ts` | topics, limits, validation, header-safe text, rate limiter (no server code) |
| `src/lib/support/mail.ts` | builds the email |
| `src/lib/support/support.server.ts` | saving, rate limiting, SMTP, the address setting, the inbox |
| `src/lib/support/api.ts` | server functions for the page and the console |
| `src/routes/contact.tsx` | the page |
| `src/components/support-admin.tsx` | the console tab |
