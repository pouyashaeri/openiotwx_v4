#!/usr/bin/env node
/**
 * The browser flasher end to end: configure (step 1) → continue to Flash (step 2,
 * which used to 404) → the four-step bar, the next-step panel, and the phone menu.
 *
 *   node scripts/e2e-flasher.mjs [baseUrl]
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

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
// A cancelled cross-document page fade (from a quick reload) is a browser notice, not a bug.
page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));

try {
  // Step 1 → step 2.
  await page.goto(`${base}/flash-wizard/index.html?device=esp32&link=wifi&from=plan`, { waitUntil: "domcontentloaded" });
  await page.getByText("From your plan").waitFor();
  await page.locator("#esp_id").fill("m5atom/esp32/e2e");
  await page.locator("#esp_topic").fill("ncar/iotwx/test/station000");
  await page.locator("#esp_wifi_ssid").fill("Test Network");
  await page.locator("#esp_mq_ip").fill("iotwx.ucar.edu");
  await page.locator("#configForm button[type=submit]").first().click();
  await page.waitForURL((u) => u.pathname.endsWith("/flash.html"), { timeout: 15000 });
  ok("Configure leads to the Flash step (no more 404)");

  // The Flash step itself.
  await page.getByRole("heading", { name: /Flash your station|Flash/ }).first().waitFor({ timeout: 10000 }).catch(() => undefined);
  const title = await page.locator(".page-title").first().innerText();
  expect(/Flash your station/.test(title), `the flash page renders ("${title}")`);
  const steps = (await page.locator(".steps .step").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  expect(steps.length === 4 && /Configure/.test(steps[0]) && /Flash/.test(steps[1]) && /Deploy and Publish/.test(steps[2]) && /Track and Forecast/.test(steps[3]), `four-step bar: ${steps.join(" › ")}`);
  expect((await page.locator('.steps a.step[href="/deploy"]').count()) === 1, "step 3 links to Deploy and Publish");
  const fw = await page.request.get(`${base}/flash-wizard/firmware/mesonet_esp32.bin`);
  expect(fw.status() === 200 && Number(fw.headers()["content-length"] ?? 0) > 1_000_000, "the firmware file it flashes is served");
  await page.getByRole("link", { name: "Next: Deploy and Publish" }).waitFor();
  ok("a Next: Deploy and Publish button waits at the bottom");
  await page.screenshot({ path: "screenshots/platform-flasher-flash.png", fullPage: true });

  // A radio plan also shows the Raspberry Pi step and button.
  await page.evaluate(() => localStorage.setItem("openiotwx-draft-v3", JSON.stringify({ answers: { link: "lora", measures: ["air"] }, step: "review" })));
  await page.reload({ waitUntil: "domcontentloaded" });
  const radio = (await page.locator(".steps .step").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  expect(radio.length === 5 && /Raspberry Pi gateway/.test(radio[2]), `a radio plan gets the gateway step (${radio.length} steps)`);
  expect(await page.locator("#piNext").isVisible(), "and a Raspberry Pi button");
  await page.evaluate(() => localStorage.removeItem("openiotwx-draft-v3"));

  // Phone menu on the Flash page.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(!(await page.locator('header .site-nav a:has-text("Wizard")').isVisible()), "on a phone the links are folded away");
  await page.locator("#menuBtn").click();
  const links = (await page.locator("header .site-nav a:visible").allInnerTexts()).map((s) => s.trim());
  expect(links.includes("Wizard") && links.includes("Map") && links.includes("Flash"), `the three-line button opens the menu (${links.join(", ")})`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(!overflow, "no sideways scrolling on a phone");

  // The flasher's 404-prone first-visit case: Flash opened with no saved setup should not crash.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${base}/flash-wizard/flash.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  ok("opening Flash with no saved setup does not crash the page");

  if (errors.length) bad(`browser errors: ${errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  bad(e.message);
  await page.screenshot({ path: "screenshots/e2e-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? "FLASHER E2E FAILED" : "Flasher E2E passed");
process.exitCode = failed ? 1 : 0;
