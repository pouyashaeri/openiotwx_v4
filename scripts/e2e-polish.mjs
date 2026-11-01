#!/usr/bin/env node
/**
 * The interface polish carried over from v2/v3: smooth scrolling, the NCAR logo
 * hover, the animated chat with its avatar and typed replies, and page transitions.
 *
 *   node scripts/e2e-polish.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080";
let failed = false;
const ok = (m) => console.log("ok  ", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (c, m) => (c ? ok(m) : bad(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


/** Answer whatever the chat is asking, once its reply has finished typing. */
async function answerOne(dialog, text) {
  const write = dialog.getByRole("button", { name: "Write my plan" });
  const multi = dialog.getByRole("group", { name: "Pick all that apply" });
  const quick = dialog.getByRole("group", { name: "Quick answers" });
  const input = dialog.getByLabel("Your answer");
  // Chips show only after the reply is typed out; a text question shows the input enabled and no chips.
  for (let i = 0; i < 40; i += 1) {
    if (await write.isVisible().catch(() => false)) return "done";
    if (await multi.isVisible().catch(() => false)) {
      await multi.getByRole("button").nth(1).click();
      await multi.getByRole("button", { name: /^Send/ }).click();
      return "multi";
    }
    if (await quick.isVisible().catch(() => false)) {
      await quick.getByRole("button").first().click();
      return "single";
    }
    await sleep(250);
  }
  if (await input.isEnabled().catch(() => false)) {
    await input.fill(text);
    await input.press("Enter");
    return "text";
  }
  return "stuck";
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
// A cancelled cross-document page fade (from a quick reload) is a browser notice, not a bug.
page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));

try {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });

  // Smooth scrolling.
  const behavior = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  expect(behavior === "smooth", `the page scrolls smoothly (scroll-behavior: ${behavior})`);
  const samples = [];
  await page.getByRole("link", { name: "Plan a station" }).click();
  for (let i = 0; i < 8; i += 1) {
    samples.push(await page.evaluate(() => Math.round(window.scrollY)));
    await sleep(70);
  }
  const final = samples[samples.length - 1];
  const inBetween = samples.filter((y) => y > 0 && y < final).length;
  expect(final > 200 && inBetween >= 1, `clicking "Plan a station" glides down instead of jumping (${samples.join(" → ")})`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

  // NCAR logo: very slightly lighter than the original, with a dark shadow, and a little darker on hover (the shadow stays the same).
  const logo = page.getByRole("link", { name: "NCAR and UCAR" });
  const filter = () => logo.locator("img").evaluate((el) => getComputedStyle(el).filter);
  const parts = (f) => ({ bright: Number(/brightness\(([\d.]+)\)/.exec(f)?.[1]), glow: /drop-shadow\([^)]*\)[^)]*\)/.exec(f)?.[0] ?? /drop-shadow\(.*\)/.exec(f)?.[0] });
  const before = parts(await filter());
  await logo.hover();
  await sleep(500);
  const after = parts(await filter());
  expect(Boolean(before.glow) && before.glow === after.glow, "the NCAR logo has a dark shadow, and hovering does not change it");
  expect(before.bright === 1.1, "the NCAR logo is very slightly lighter than the original at rest");
  expect(after.bright === 1.3, `hovering brightens the logo to the hover level in index.tsx (brightness ${before.bright} → ${after.bright})`);
  await page.mouse.move(5, 5);

  // Chat: avatar, typing, animation, full screen, close.
  const open = page.getByRole("button", { name: "Chat to plan your station" });
  await open.waitFor();
  await open.click();
  const dialog = page.getByRole("dialog", { name: /Plan your station by chatting/ });
  await dialog.waitFor();
  ok("the chat opens from a round button");
  const avatar = dialog.locator("img").first();
  await avatar.waitFor();
  const loaded = await avatar.evaluate((img) => img.complete && img.naturalWidth > 0);
  expect(loaded, "the assistant's avatar picture shows beside its messages");

  // The first reply types itself out.
  const bubble = dialog.locator("div.rounded-bl-sm").first();
  const t1 = (await bubble.innerText()).length;
  await sleep(250);
  const t2 = (await bubble.innerText()).length;
  await sleep(2500);
  const t3 = (await bubble.innerText()).length;
  expect(t2 > t1 || t3 > t2, `replies type themselves out (${t1} → ${t2} → ${t3} characters)`);

  // Work through the questions with the quick answers until it offers to write the plan.
  for (let i = 0; i < 24; i += 1) {
    if ((await answerOne(dialog, "skip")) === "done") break;
    await sleep(300);
  }
  await dialog.getByRole("button", { name: "Write my plan" }).waitFor({ timeout: 15000 });
  ok("the chat walks through the questions and offers to write the plan");
  await page.screenshot({ path: "screenshots/platform-chat.png" });

  // Full screen toggles, Escape closes with the closing animation.
  await dialog.getByRole("button", { name: "Full screen" }).click();
  await sleep(450);
  expect((await dialog.getAttribute("data-expanded")) === "true", "full screen works");
  await page.keyboard.press("Escape"); // leaves full screen first
  await sleep(350);
  expect((await dialog.getAttribute("data-expanded")) === "false", "Escape leaves full screen first");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 3000 });
  ok("Escape closes the chat with an animation");

  // Reopening continues where it left off; "Start the chat over" begins again.
  await open.click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Write my plan" }).waitFor();
  ok("closing and reopening the chat keeps the conversation");
  await dialog.getByRole("button", { name: "Start the chat over" }).click();
  await dialog.getByRole("button", { name: "Write my plan" }).waitFor({ state: "hidden" });
  ok("starting over clears it");
  // The name is typed; the location question after it is skipped (a made-up place cannot be found).
  let typed = 0;
  for (let i = 0; i < 40; i += 1) {
    const how = await answerOne(dialog, typed === 0 ? "Chat Test Site" : "skip");
    if (how === "done") break;
    if (how === "text") typed += 1;
    await sleep(300);
  }
  await dialog.getByRole("button", { name: "Write my plan" }).click();
  await page.waitForURL((u) => u.pathname === "/plan", { timeout: 15000 });
  await page.locator("main h1", { hasText: "Chat Test Site" }).waitFor({ timeout: 15000 });
  ok("Write my plan fills in the plan page");

  // The header stays put while pages cross-fade (view-transition name on the sticky header).
  const vt = await page.evaluate(() => getComputedStyle(document.querySelector("header.sticky")).viewTransitionName);
  expect(vt === "site-header", `the header holds still during page transitions (${vt})`);

  if (errors.length) bad(`browser errors: ${errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  bad(e.message);
  await page.screenshot({ path: "screenshots/e2e-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? "POLISH E2E FAILED" : "Polish E2E passed");
process.exitCode = failed ? 1 : 0;
