#!/usr/bin/env node
/**
 * Raspberry Pi gateway guide: only radio (LoRa) plans see it, its commands follow
 * the person's own names, and unsafe input never reaches a command.
 *
 *   node scripts/e2e-pi.mjs [baseUrl]
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

const draft = (answers) =>
  JSON.stringify({
    answers: { intent: "community", place: "rural", power: "solar", link: "lora", measures: ["air", "rain"], sharp: false, count: 3, surprises: [], who: [], progress: [], gaps: [], ...answers },
    step: "review",
    checks: {},
    goals: [],
    goalLog: [],
    goalsTouched: false,
    siteName: "Ridge",
    startedAt: new Date().toISOString(),
  });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
// A cancelled cross-document page fade (from a quick reload) is a browser notice, not a bug.
page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));
const useDraft = async (answers) => {
  await page.goto(`${base}/`);
  await page.evaluate((d) => localStorage.setItem("openiotwx-draft-v3", d), draft(answers));
};

try {
  // A Wi-Fi plan has no Pi: no button, no step, and the page says so.
  await useDraft({ link: "wifi", place: "urban", power: "outlet" });
  await page.goto(`${base}/plan`);
  await page.getByRole("link", { name: "Flash this plan's board" }).waitFor({ timeout: 20000 });
  expect((await page.getByRole("link", { name: "Set up the Raspberry Pi gateway" }).count()) === 0, "a Wi-Fi plan has no Raspberry Pi button");
  await page.goto(`${base}/raspberry-pi`);
  await page.getByRole("heading", { name: "No Raspberry Pi in this plan" }).waitFor();
  ok("the guide itself is not shown to a Wi-Fi plan");
  await page.goto(`${base}/deploy`);
  await page.waitForTimeout(1500);

  // A LoRa plan does.
  await useDraft({});
  await page.goto(`${base}/plan`);
  await page.getByRole("link", { name: "Set up the Raspberry Pi gateway" }).click();
  await page.waitForURL((u) => u.pathname === "/raspberry-pi");
  await page.getByRole("heading", { name: "Set up the Raspberry Pi" }).waitFor();
  ok("a LoRa plan gets the button and the guide");
  const bar = await page.getByRole("navigation", { name: "Setup steps" }).innerText();
  expect(/Flash[\s\S]*Raspberry Pi gateway[\s\S]*Deploy and Publish/.test(bar), "the step bar gains a Raspberry Pi step between Flash and Deploy");
  expect((await page.locator('[role="img"]').count()) >= 4, "the guide has its four illustrations");
  expect((await page.locator("main ol > li h2").count()) >= 9, "all nine steps are there");

  // Default account is the one the scripts shipped with: nothing to change.
  await page.getByText("so there is nothing to change").waitFor();
  ok("with the shipped account name there is nothing to rewrite");

  // Another account: every command follows.
  await page.getByLabel("Pi username").fill("pouya");
  await page.getByLabel("Pi hostname").fill("roof-gw");
  const pre = () => page.locator("pre").allInnerTexts().then((a) => a.join("\n---\n"));
  let text = await pre();
  expect(text.includes("ssh pouya@roof-gw.local"), "the ssh command uses their username and hostname");
  expect(text.includes("s#/home/ncar#/home/pouya#g") && text.includes("s#^User=ncar$#User=pouya#"), "the path and user rewrite command is generated");
  expect(text.includes("cd ~/mesonet-siparcs25/edge-servers") && text.includes("bash deploy.sh"), "clone, folder and deploy commands are present");
  expect(text.includes("sudo systemctl disable --now lora-gateway"), "how to stop it for good is shown");

  // Broker settings land in pi_config.json.
  await page.getByRole("textbox", { name: "MQTT broker" }).fill("mqtt.example.org");
  await page.getByRole("spinbutton", { name: "Broker port" }).fill("1884");
  await page.getByLabel("Gateway name").fill("ridge-pi");
  text = await pre();
  const cfg = /cat > pi_config\.json <<'EOF'\n([\s\S]*?)\nEOF/.exec(text)?.[1];
  const parsed = cfg ? JSON.parse(cfg) : null;
  expect(parsed?.mqtt.broker_ip === "mqtt.example.org" && parsed.mqtt.broker_port === 1884 && parsed.radio.edge_id === "ridge-pi", "pi_config.json carries their broker, port and gateway name");

  // Unsafe input is refused and never shown in a command.
  await page.getByLabel("Pi username").fill("x;rm -rf ~");
  await page.getByRole("alert").waitFor();
  text = await pre();
  expect(!text.includes("rm -rf") && text.includes("ssh ncar@"), "an unsafe username is flagged and never reaches a command");
  await page.getByLabel("Pi username").fill("pouya");

  // Progress is remembered.
  await page.getByRole("button", { name: "Mark step 1 done" }).click();
  await page.reload();
  await page.getByText(/1 of 9 steps ticked/).waitFor({ timeout: 15000 });
  ok("ticked steps are remembered");
  await page.screenshot({ path: "screenshots/platform-pi-guide.png", fullPage: true });

  // Static flasher shows the extra step for a LoRa plan.
  await page.goto(`${base}/flash-wizard/index.html`, { waitUntil: "domcontentloaded" });
  const steps = await page.locator(".steps .step").allInnerTexts();
  expect(steps.length === 5 && /Raspberry Pi gateway/.test(steps[2]), `the flasher's bar adds the gateway step (${steps.length} steps)`);

  if (errors.length) bad(`browser errors: ${errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  bad(e.message);
  await page.screenshot({ path: "screenshots/e2e-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? "PI E2E FAILED" : "Pi E2E passed");
process.exitCode = failed ? 1 : 0;
