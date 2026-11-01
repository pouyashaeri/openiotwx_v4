import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG_FIT, classicFit, fitsPlace, recommend } from "./recommend.ts";
import { blankAnswers, type Answers } from "./types.ts";

// These tests follow the NCAR configuration sheet (columns A–E) row by row.

function answers(patch: Partial<Answers>): Answers {
  return { ...blankAnswers(), intent: "watch", place: "urban", count: 1, ...patch };
}
const cfg = (patch: Partial<Answers>) => recommend(answers(patch));

describe("Communication row picks the family", () => {
  it("Wi-Fi → A or B", () => {
    assert.ok(["A", "B"].includes(cfg({ link: "wifi", measures: ["air"] }).configId));
  });
  it("cellular → C, LoRa → D", () => {
    assert.equal(cfg({ link: "cell", place: "edge", measures: ["air"] }).configId, "C");
    assert.equal(cfg({ link: "lora", place: "rural", measures: ["air"] }).configId, "D");
  });
  it("ham radio is not buildable: D, marked experimental, E declined", () => {
    const r = cfg({ link: "ham", place: "extreme", measures: ["air"] });
    assert.equal(r.configId, "D");
    assert.equal(r.experimental, true);
    assert.ok(r.declined.some((d) => d.id === "E"));
  });
});

describe("A, classic: the Atom Lite alone, one Grove serial slot", () => {
  it("a simple Qwiic + rain list stays on A with no extension base", () => {
    const r = cfg({ link: "wifi", measures: ["air", "rain", "sun"] });
    assert.equal(r.configId, "A");
    assert.equal(r.includePoeBase, false);
    assert.equal(r.baseCents, 0);
  });
  it("RS485 Y*: one RS-485 sensor is fine on A without PoE and without rain", () => {
    const r = cfg({ link: "wifi", measures: ["air", "wind"] });
    assert.equal(r.configId, "A");
    assert.match(r.ports.join(" "), /one device/i);
  });
  it("RS485 max 1: wind + soil moves to B", () => {
    assert.equal(cfg({ link: "wifi", measures: ["wind", "soil"] }).configId, "B");
  });
  it("RS485 with rain: not on A (the serial slot is shared)", () => {
    assert.equal(cfg({ link: "wifi", measures: ["rain", "wind"] }).configId, "B");
  });
  it("Power row: A is PoE or a plug, so solar moves a Wi-Fi station to B", () => {
    assert.equal(cfg({ link: "wifi", power: "solar", measures: ["air"] }).configId, "B");
    assert.equal(cfg({ link: "wifi", power: "outlet", measures: ["air"] }).configId, "A");
  });
});

describe("PoE row: only A, only with the PoE base", () => {
  it("PoE with a Qwiic list: A with the $18.50 base", () => {
    const r = cfg({ link: "poe", measures: ["air"] });
    assert.equal(r.configId, "A");
    assert.equal(r.includePoeBase, true);
    assert.equal(r.baseCents, 1850);
    assert.deepEqual(r.conflicts, []);
  });
  it("PoE with rain only is fine (no Qwiic chain)", () => {
    const r = cfg({ link: "poe", measures: ["rain"] });
    assert.equal(r.includePoeBase, true);
  });
  it("PoE + rain + Qwiic is not buildable: PoE is dropped and the plan says so", () => {
    const r = cfg({ link: "poe", measures: ["air", "rain"] });
    assert.equal(r.includePoeBase, false);
    assert.equal(r.conflicts.length, 1);
    assert.match(r.conflicts[0], /PoE cannot be built/);
  });
  it("PoE + RS-485 is not buildable anywhere (A forbids it, B has no PoE)", () => {
    const r = cfg({ link: "poe", measures: ["wind"] });
    assert.equal(r.includePoeBase, false);
    assert.match(r.conflicts.join(" "), /RS-485 cannot share the classic build with the PoE base/);
  });
});

describe("B, Wi-Fi + PortABC: the multi-measurement Wi-Fi build", () => {
  it("costs $9.09 and allows up to three RS-485 devices", () => {
    const r = cfg({ link: "wifi", measures: ["wind", "soil"] });
    assert.equal(r.baseCents, 909);
    assert.match(r.ports.join(" "), /up to three RS-485/);
    assert.equal(r.includePoeBase, false);
  });
  it("explains why A could not carry the list", () => {
    const r = cfg({ link: "wifi", measures: ["wind", "soil"] });
    assert.match(r.reasons.join(" "), /one RS-485 sensor at most/);
  });
});

describe("C and D: two RS-485 devices, rain on Grove", () => {
  it("C is $17.90 with native + Port A RS-485", () => {
    const r = cfg({ link: "cell", place: "edge", measures: ["wind", "soil", "rain"] });
    assert.equal(r.configId, "C");
    assert.equal(r.baseCents, 1790);
    assert.match(r.ports.join(" "), /two devices maximum/);
  });
  it("D is $22.90 and mentions pair-to-pair", () => {
    const r = cfg({ link: "lora", place: "rural", count: 3, measures: ["air", "rain"] });
    assert.equal(r.baseCents, 2290);
    assert.match(r.reasons.join(" "), /gateway/);
  });
  it("Power row: solar sizes are B 6–10 W, C ~20 W, D ~10 W", () => {
    assert.match(cfg({ link: "wifi", power: "solar", measures: ["air"] }).power, /6–10 W/);
    assert.match(cfg({ link: "cell", place: "edge", power: "solar", measures: ["air"] }).power, /20 W/);
    assert.match(cfg({ link: "lora", place: "rural", power: "solar", measures: ["air"] }).power, /10 W/);
  });
});

describe("Deployment scenario row (soft: warns, keeps your link)", () => {
  it("the fit table is the sheet's", () => {
    assert.deepEqual(CONFIG_FIT.A, ["urban"]);
    assert.deepEqual(CONFIG_FIT.B, ["urban"]);
    assert.deepEqual(CONFIG_FIT.C, ["urban", "suburban", "semi-rural"]);
    assert.deepEqual(CONFIG_FIT.D, ["rural", "remote", "urban", "suburban"]);
    assert.deepEqual(CONFIG_FIT.E, ["extreme"]);
  });
  it("indoors, home and town all count as urban", () => {
    for (const place of ["indoors", "home", "urban"] as const) {
      assert.ok(fitsPlace("A", place) && fitsPlace("B", place), place);
    }
  });
  it("Wi-Fi in town: no place note", () => {
    const r = cfg({ link: "wifi", place: "urban", measures: ["air"] });
    assert.ok(!/specified for/.test(r.reasons.join(" ")));
  });
  it("Wi-Fi at the edge of town keeps A but says the sheet fits cellular", () => {
    const r = cfg({ link: "wifi", place: "edge", measures: ["air"] });
    assert.equal(r.configId, "A");
    assert.match(r.reasons[0], /Edge cellular \(C\)/);
  });
  it("cellular in the countryside says the sheet fits radio there", () => {
    const r = cfg({ link: "cell", place: "rural", measures: ["air"] });
    assert.equal(r.configId, "C");
    assert.match(r.reasons[0], /Radio link \(D\)/);
  });
  it("LoRa fits town, countryside and remote sites", () => {
    for (const place of ["urban", "edge", "rural", "extreme"] as const) {
      const r = cfg({ link: "lora", place, measures: ["air"] });
      assert.ok(!/specified for/.test(r.reasons.join(" ")), place);
    }
  });
  it("a remote site on Wi-Fi points to the LoRa build, with amateur radio as the later option", () => {
    const r = cfg({ link: "wifi", place: "extreme", measures: ["air"] });
    assert.match(r.reasons[0], /LoRa build \(D\)/);
    assert.match(r.reasons[0], /\(E\)/);
  });
});

describe("classicFit", () => {
  it("lists every reason the classic build cannot carry a list", () => {
    const a = answers({ link: "poe", measures: ["wind", "soil", "rain", "air"] });
    const r = classicFit(a, true);
    assert.equal(r.ok, false);
    assert.ok(r.blockers.length >= 3);
  });
});
