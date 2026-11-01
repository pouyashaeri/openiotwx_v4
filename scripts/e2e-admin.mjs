#!/usr/bin/env node
/**
 * Role and user-management check. Run against a FRESH database (restart `npm run dev`),
 * because the first account becomes the super-admin.
 *
 *   node scripts/e2e-admin.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080";
const stamp = Date.now();
const PASSWORD = "correct-horse-battery";
const people = {
  boss: `boss-${stamp}@example.com`,
  mia: `mia-${stamp}@example.com`,
  cy: `cy-${stamp}@example.com`,
};
let failed = false;
const ok = (m) => console.log("ok  ", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (cond, m) => (cond ? ok(m) : bad(m));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const open = async () => (await browser.newContext()).newPage();

async function signUp(page, email, name) {
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL((u) => u.pathname === "/account");
  await page.getByRole("heading", { name }).waitFor();
}

async function staffLogin(page, email, password = PASSWORD) {
  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

try {
  const boss = await open();
  const mia = await open();
  const cy = await open();

  await signUp(boss, people.boss, "Boss");
  await signUp(mia, people.mia, "Mia");
  await signUp(cy, people.cy, "Cy");

  // The admin console is not advertised anywhere.
  const nav = await mia.locator("header").innerText();
  expect(!/admin/i.test(nav), "no Admin entry in the navigation for a regular user");
  const boss_nav = await boss.locator("header").innerText();
  expect(!/admin/i.test(boss_nav), "no Admin entry in the navigation for the super-admin either");

  // A regular signed-in user sees an ordinary not-found page.
  await mia.goto(`${base}/admin`);
  await mia.getByRole("heading", { name: "Page not found" }).waitFor({ timeout: 15000 });
  ok("regular user gets a plain 'not found' at /admin");

  // The staff login refuses a regular account and does not leave it signed in.
  await staffLogin(mia, people.mia);
  await mia.getByText("don't match a staff account").waitFor({ timeout: 15000 });
  await mia.goto(`${base}/account`);
  await mia.waitForTimeout(1500);
  expect(new URL(mia.url()).pathname === "/login", "staff login with a regular account is refused and signs it out");

  // Signed-out visitors are sent to the staff login, not the public one.
  const anon = await open();
  await anon.goto(`${base}/admin`);
  await anon.waitForURL((u) => u.pathname === "/admin/login", { timeout: 15000 });
  ok("signed-out visit to /admin lands on the staff login");

  // Super-admin signs in on the staff page and manages people.
  await staffLogin(boss, people.boss);
  await boss.getByRole("heading", { name: "Network operations" }).waitFor({ timeout: 15000 });
  await boss.getByText("Super-admin console").waitFor();
  ok("super-admin reaches the console through the staff login");
  await boss.getByRole("tab", { name: "users" }).click();

  const row = (email) => boss.locator("li", { hasText: email });

  // Promote Mia to admin.
  await row(people.mia).getByRole("button", { expanded: false }).click();
  await row(people.mia).getByRole("button", { name: "Make admin" }).click();
  await row(people.mia).getByText("admin", { exact: true }).waitFor({ timeout: 15000 });
  ok("super-admin can make a user an admin");

  // Mia (now admin) can enter the console, but cannot manage another admin or promote anyone.
  await staffLogin(mia, people.mia);
  await mia.getByRole("heading", { name: "Network operations" }).waitFor({ timeout: 15000 });
  await mia.getByText("Admin console", { exact: true }).waitFor();
  await mia.getByRole("tab", { name: "users" }).click();
  await mia.locator("li", { hasText: people.boss }).getByRole("button").first().click();
  await mia.getByText("Super-admins are set in the server configuration").waitFor();
  ok("an admin cannot touch a super-admin");
  await mia.locator("li", { hasText: people.cy }).getByRole("button", { expanded: false }).click();
  expect((await mia.getByRole("button", { name: "Make admin" }).count()) === 0, "an admin has no promote button");

  // Admin resets Cy's password; Cy can sign in with the temporary one and not the old one.
  await mia.locator("li", { hasText: people.cy }).getByRole("button", { name: "Reset password" }).click();
  await mia.getByRole("dialog").getByRole("button").last().click(); // the themed confirm
  const temp = (await mia.locator("pre").first().innerText()).trim();
  expect(temp.length >= 8, "password reset shows a one-time temporary password");
  const cy2 = await open();
  await cy2.goto(`${base}/login`, { waitUntil: "networkidle" });
  await cy2.getByLabel("Email").fill(people.cy);
  await cy2.getByLabel("Password").fill(PASSWORD);
  await cy2.getByRole("button", { name: "Sign in", exact: true }).click();
  await cy2.getByRole("alert").waitFor({ timeout: 15000 });
  ok("old password no longer works after a reset");
  await cy2.getByLabel("Password").fill(temp);
  await cy2.getByRole("button", { name: "Sign in", exact: true }).click();
  await cy2.waitForURL((u) => u.pathname === "/account", { timeout: 15000 });
  ok("temporary password signs the person in");

  // Suspend Cy: the live session is cut and access is refused.
  await mia.locator("li", { hasText: people.cy }).getByRole("button", { name: "Suspend" }).click();
  await mia.locator("li", { hasText: people.cy }).getByText("suspended").waitFor({ timeout: 15000 });
  await cy2.goto(`${base}/account`);
  await cy2.waitForTimeout(2000);
  expect(new URL(cy2.url()).pathname === "/login", "suspending a user signs them out");

  // Delete Cy entirely.
  await mia.locator("li", { hasText: people.cy }).getByRole("button", { name: "Delete account" }).click();
  await mia.getByRole("dialog").getByRole("button").last().click(); // the themed confirm
  await mia.locator("li", { hasText: people.cy }).waitFor({ state: "detached", timeout: 15000 });
  ok("admin can delete a regular account");

  await boss.screenshot({ path: "screenshots/platform-admin-users.png" });
} catch (e) {
  bad(e.message);
} finally {
  await browser.close();
}
console.log(failed ? "ADMIN E2E FAILED" : "Admin E2E passed");
process.exitCode = failed ? 1 : 0;
