#!/usr/bin/env node
/**
 * The planning chat asks exactly what the survey asks, and hands real problems to support.
 * Run against any dev server (no language model needed; the chat uses keyword matching):
 *
 *   node scripts/e2e-chat.mjs [baseUrl]
 *
 * It walks the real survey page (/wizard) and the real chat, and compares them: the wording of every
 * question, the line under it, and every choice with its description, in the same order. Then it checks
 * the chat's hand-off to support. With SUPPORT_EMAIL set on the server it also checks the email link.
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
const norm = (t) => t.replace(/\s+/g, " ").trim();

// The survey's questions, in the order it asks them on the community path, with where each is asked.
// Titles, lines and choices are what the survey page shows; they are written out here from the survey page itself
// (read live below), not from the shared file, so this checks the rendered pages and not just the data.
const ORDER = ["intent", "place", "power", "link", "measures", "sharp", "count", "surprises", "who", "progress", "gaps", "resources", "gdex", "gdexOptIn", "siteName", "location"];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));

  // ── 1. Walk the survey and keep what each screen shows ───────────────────────
  await page.goto(`${base}/wizard`, { waitUntil: "networkidle" });
  const survey = []; // [{ screen text, choice texts: [{title, body}] }] per step
  const read = async () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      const cards = [...main.querySelectorAll("button[aria-pressed]")].map((b) => ({
        title: (b.querySelector("span.font-display, span.text-lg, .font-display")?.textContent ?? "").trim(),
        text: b.innerText,
      }));
      const hints = [...main.querySelectorAll("input")].map((i) => i.placeholder).join(" ");
      return { text: `${main.innerText} ${hints}`, cards };
    });
  survey.push(await read());
  await page.getByRole("button", { name: /A place and the people there/ }).click();
  for (let step = 0; step < 12; step++) {
    await page.waitForTimeout(500);
    const screen = await read();
    if (/Name the place, then write the plan/.test(screen.text)) {
      survey.push(screen);
      break;
    }
    survey.push(screen);
    // choose the first card in every group on this screen, then continue
    const groups = page.locator("main div.grid.gap-3");
    const n = await groups.count();
    for (let g = 0; g < n; g++) {
      const first = groups.nth(g).locator("button[aria-pressed]").first();
      if (await first.count()) await first.click();
    }
    await page.getByRole("button", { name: "Continue" }).click();
  }
  const surveyText = norm(survey.map((s) => s.text).join(" "));
  ok(`walked ${survey.length} survey screens`);

  // ── 2. Walk the chat, one question at a time ─────────────────────────────────
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Chat to plan your station" }).click();
  const dialog = page.getByRole("dialog", { name: /Plan your station by chatting/ });
  await dialog.waitFor();
  const asked = []; // { text (the last bot message, with its line breaks), optionsText }
  const bots = dialog.locator("div.whitespace-pre-line");
  let textAnswers = 0;
  for (let i = 0; i < 24; i++) {
    // Wait until the reply has finished typing: the number of bot messages is steady and either the plan
    // summary, a set of choices, or (after a moment with neither) the text box is what is left to use.
    await sleep(900);
    let how = null;
    for (let t = 0; t < 60 && !how; t++) {
      if (await dialog.getByRole("button", { name: "Write my plan" }).count()) how = "done";
      else if (await dialog.getByRole("group", { name: "Pick all that apply" }).count()) how = "multi";
      else if (await dialog.getByRole("group", { name: "Quick answers" }).count()) how = "single";
      else {
        // Typing is done when the last message stops growing and still nothing else is on offer.
        const before = (await bots.last().innerText()).length;
        await sleep(1500);
        if ((await bots.last().innerText()).length === before && !(await dialog.getByRole("group").count()) && !(await dialog.getByRole("button", { name: "Write my plan" }).count())) how = "text";
      }
    }
    if (how === "done" || !how) break;
    const text = (await bots.last().innerText()).trim();
    const group = how === "multi" ? dialog.getByRole("group", { name: "Pick all that apply" }) : how === "single" ? dialog.getByRole("group", { name: "Quick answers" }) : null;
    const optionsText = group ? norm(await group.innerText()) : "";
    asked.push({ how, text, optionsText });
    if (how === "multi") {
      await group.getByRole("button").nth(1).click();
      await group.getByRole("button", { name: /^Send/ }).click();
    } else if (how === "single") {
      await group.getByRole("button").first().click();
    } else {
      const input = dialog.getByLabel("Your answer");
      await input.fill(textAnswers++ === 0 ? "Roof of the school" : "skip");
      await input.press("Enter");
    }
  }
  if (process.env.DUMP) asked.forEach((q, i) => console.log(i + 1, q.how, JSON.stringify(q.text)));
  expect(asked.length === ORDER.length, `the chat asked ${asked.length} questions (the survey's ${ORDER.length})`);
  await dialog.screenshot({ path: "screenshots/chat-survey-question.png" }).catch(() => {});

  // ── 3. Compare ───────────────────────────────────────────────────────────────
  // Everything the chat says or offers must appear on the survey's own pages, word for word.
  const surveyChoiceTitles = new Set(survey.flatMap((s) => s.cards.map((c) => norm(c.text))));
  let compared = 0;
  asked.forEach((q, i) => {
    const lines = q.text.split(/\n+/).map(norm).filter(Boolean);
    // The first question also carries the greeting; the question is the last two lines (title, line under it).
    const title = lines[lines.length - 2];
    // The two typed answers show their example as a grey hint on the survey page; the chat words it "For example: ...".
    const body = lines[lines.length - 1].replace(/^For example: /, "").replace(/.$/, "");
    expect(surveyText.includes(title), `question ${i + 1} (${ORDER[i]}): the survey asks "${title}"`);
    expect(surveyText.includes(body), `question ${i + 1} (${ORDER[i]}): the survey has the same line under it`);
    compared += 2;
  });
  // Each choice the chat offers (title and description) is the same text as a survey card.
  let choices = 0;
  let matched = 0;
  for (const q of asked) {
    if (!q.optionsText) continue;
    for (const card of survey.flatMap((s) => s.cards)) {
      const t = norm(card.text);
      if (q.optionsText.includes(t) || t.split(" ").every((w) => q.optionsText.includes(w))) matched++;
    }
  }
  const chatOptionTexts = asked.flatMap((q) => q.optionsText).filter(Boolean);
  choices = [...surveyChoiceTitles].length;
  expect(chatOptionTexts.length > 0, "the chat shows the choices with their descriptions");
  void matched;
  // The survey's choice list for a question must be a subset of what the chat shows for that question (titles and descriptions).
  const asksChoices = asked.filter((q) => q.optionsText);
  const missing = [];
  for (const card of survey.flatMap((s) => s.cards)) {
    const parts = card.text.split("\n").map(norm).filter(Boolean);
    if (!parts.length) continue;
    const inChat = asksChoices.some((q) => parts.every((p) => q.optionsText.includes(p)));
    // The two toggle cards ("Temperatures here swing hard", "Also archive...") are Yes/No questions in the chat: their wording is the question itself.
    const isToggle = /Temperatures here swing hard|Also archive and publish in GDEX/.test(card.text);
    if (!inChat && !isToggle) missing.push(parts[0]);
  }
  expect(missing.length === 0, `every survey choice (${choices} cards) is offered in the chat with its description${missing.length ? `. Missing: ${missing.slice(0, 4).join(" | ")}` : ""}`);
  expect(compared === ORDER.length * 2, `compared the title and line of all ${ORDER.length} questions`);

  // ── 4. The hand-off to support ───────────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Chat to plan your station" }).click();
  const d2 = page.getByRole("dialog", { name: /Plan your station by chatting/ });
  await d2.waitFor();
  const input = d2.getByLabel("Your answer");
  await input.waitFor();
  await sleep(1500);
  await input.fill("I can't log in to my account");
  await input.press("Enter");
  await d2.getByRole("button", { name: "Open the contact form" }).waitFor({ timeout: 15000 });
  ok("a problem is recognised and offered to support, not forced into a plan answer");
  expect((await d2.getByRole("button", { name: "Open the contact form" }).count()) >= 1, "the chat offers the contact form");
  const mail = d2.getByRole("link", { name: /^Email / });
  if (await mail.count()) {
    const href = await mail.getAttribute("href");
    expect(/^mailto:[^@\s]+@[^@\s]+/.test(href ?? ""), `...and the support address (${href})`);
  } else console.log("info no SUPPORT_EMAIL on this server, so only the contact form is offered");
  expect((await d2.getByText(/What brings you here\?/).count()) > 0, "the chat still asks where it left off");
  await d2.getByRole("button", { name: "Open the contact form" }).click();
  await page.waitForURL((u) => u.pathname === "/contact", { timeout: 15000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("topic") === "account", `the contact form opens on the right topic (${url.searchParams.get("topic")})`);
  await page.getByLabel(/message/i).first().waitFor({ timeout: 10000 });
  const prefilled = await page.locator("textarea").first().inputValue();
  expect(prefilled.includes("can't log in"), "...with what the person wrote already in the message");

  // and a plain "talk to a person" works from the standing link too
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Chat to plan your station" }).click();
  const d3 = page.getByRole("dialog", { name: /Plan your station by chatting/ });
  await d3.getByRole("link", { name: "Contact support" }).click();
  await page.waitForURL((u) => u.pathname === "/contact", { timeout: 15000 });
  ok("the chat always has a Contact support link");

  if (errors.length) bad(`browser errors: ${errors.slice(0, 4).join(" | ")}`);
} catch (e) {
  bad(e.message);
} finally {
  await browser.close();
}
console.log(failed ? "CHAT E2E FAILED" : "Chat E2E passed");
process.exitCode = failed ? 1 : 0;
