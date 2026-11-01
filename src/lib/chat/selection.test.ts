import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allIds,
  applySelection,
  handleUserMessage,
  initialState,
  nextField,
  summarize,
  type ChatState,
  type Extractor,
} from "./engine.ts";
import { parseSelection } from "./keywords.ts";

/** A conversation that has reached the "what data should your station collect?" question. */
function atMeasures(): ChatState {
  const base = initialState();
  return {
    ...base,
    answers: { ...base.answers, intent: "community", place: "home", power: "outlet", link: "wifi" },
  };
}

/** One further along, at a community question that can also take several answers. */
function atWho(): ChatState {
  const base = atMeasures();
  return {
    ...base,
    answers: { ...base.answers, measures: ["air"], count: 1, surprises: ["dry"] },
    skipped: [],
  };
}

async function measures(text: string, extract?: Extractor) {
  const turn = await handleUserMessage(atMeasures(), text, extract);
  return [...turn.state.answers.measures].sort();
}
const without = (key: "measures" | "who", ...ids: string[]) =>
  allIds(key)
    .filter((id) => !ids.includes(id))
    .sort();

describe("several answers at once", () => {
  it("takes every choice that is named", async () => {
    assert.deepEqual(await measures("temperature, rain and soil moisture"), [
      "air",
      "rain",
      "soil",
    ]);
    assert.deepEqual(await measures("I want wind and sunlight"), ["sun", "wind"]);
  });

  it("reads plain 'air' as temperature and humidity, and 'air quality' as air quality", async () => {
    assert.deepEqual(await measures("air and rain"), ["air", "rain"]);
    assert.deepEqual(await measures("air quality"), ["pm"]);
    assert.deepEqual(await measures("air quality and temperature"), ["air", "pm"]);
  });

  it("keeps working for the optional questions", async () => {
    const turn = await handleUserMessage(atWho(), "neighbors and a school");
    assert.deepEqual([...turn.state.answers.who].sort(), ["neighbors", "school"]);
  });
});

describe("'all of them'", () => {
  for (const phrase of [
    "all of them",
    "All",
    "everything",
    "all of these",
    "every one of them",
    "the whole list",
    "all the above",
    "select all",
  ]) {
    it(`understands "${phrase}"`, async () => {
      assert.deepEqual(await measures(phrase), [...allIds("measures")].sort());
    });
  }

  it("works on the other list questions too", async () => {
    const turn = await handleUserMessage(atWho(), "all of them");
    assert.deepEqual([...turn.state.answers.who].sort(), [...allIds("who")].sort());
  });

  it("does not treat 'everything about soil' as all of them", async () => {
    assert.deepEqual(await measures("everything about soil"), ["soil"]);
  });

  it("shows a short recap line when everything is chosen", async () => {
    const turn = await handleUserMessage(atMeasures(), "all of them");
    const row = summarize(turn.state).find((r) => r.key === "measures");
    assert.equal(row?.value, "All of them (8)");
  });
});

describe("'all of them except ...'", () => {
  it("leaves out the named choices", async () => {
    assert.deepEqual(
      await measures("all of them except air and rain"),
      without("measures", "air", "rain"),
    );
    assert.deepEqual(await measures("everything except wind"), without("measures", "wind"));
    assert.deepEqual(await measures("all but soil moisture"), without("measures", "soil"));
    assert.deepEqual(
      await measures("everything apart from ozone and sunlight"),
      without("measures", "ozone", "sun"),
    );
    assert.deepEqual(
      await measures("all of them other than carbon dioxide"),
      without("measures", "co2"),
    );
    assert.deepEqual(await measures("all of them, excluding rain"), without("measures", "rain"));
    assert.deepEqual(await measures("everything without wind"), without("measures", "wind"));
  });

  it("keeps 'air' and 'air quality' apart when excluding", async () => {
    assert.deepEqual(await measures("all except air quality"), without("measures", "pm"));
    assert.deepEqual(await measures("all except air"), without("measures", "air"));
  });

  it("treats 'anything but ...' and a bare 'except ...' as everything else", async () => {
    assert.deepEqual(await measures("anything but wind"), without("measures", "wind"));
    assert.deepEqual(await measures("except rain"), without("measures", "rain"));
  });

  it("drops a named choice from a short list when told 'but not'", async () => {
    assert.deepEqual(await measures("rain, soil but not wind"), ["rain", "soil"]);
    assert.deepEqual(await measures("rain and wind except wind"), ["rain"]);
  });

  it("does not read an ordinary 'but' as an exclusion", async () => {
    assert.deepEqual(await measures("rain but also soil"), ["rain", "soil"]);
    assert.deepEqual(await measures("rain, but mostly wind"), ["rain", "wind"]);
  });

  it("works on the community questions", async () => {
    const turn = await handleUserMessage(atWho(), "everyone except the school");
    assert.deepEqual([...turn.state.answers.who].sort(), without("who", "school"));
  });

  it("repeats the result back so the person can check it", async () => {
    const turn = await handleUserMessage(atMeasures(), "all of them except air and rain");
    assert.match(turn.reply, /Got it\. Measuring:/);
    assert.doesNotMatch(turn.reply, /Air: temperature and humidity/);
    assert.doesNotMatch(turn.reply, /Rainfall/);
    assert.match(turn.reply, /Soil moisture/);
  });

  it("moves on to the next question afterwards", async () => {
    const turn = await handleUserMessage(atMeasures(), "all of them except air and rain");
    assert.equal(nextField(turn.state)?.key, "count");
  });
});

describe("with a model", () => {
  it("fixes the list when the model ignores the exception", async () => {
    // A weak model that returns everything it saw, "except" or not.
    const sloppy: Extractor = async () => ({ measures: ["air", "rain", "soil"] });
    assert.deepEqual(await measures("all of them except air", sloppy), without("measures", "air"));
    assert.deepEqual(
      await measures("soil and rain, not air", sloppy),
      ["air", "rain", "soil"].sort(),
    );
  });

  it("uses the model's own exclude list when the wording alone does not name the choice", async () => {
    const model: Extractor = async () => ({
      measures: ["rain", "wind", "soil"],
      exclude: ["wind"],
    });
    assert.deepEqual(await measures("the usual set of three please", model), ["rain", "soil"]);
  });

  it("ignores an exclude list that names things that are not choices", async () => {
    const model: Extractor = async () => ({ measures: ["rain"], exclude: ["lava", "rain-ish"] });
    assert.deepEqual(await measures("rain", model), ["rain"]);
  });

  it("does not let a model-supplied exclude leak into single-choice questions", async () => {
    const model: Extractor = async () => ({ intent: "teach", exclude: ["teach"] });
    const turn = await handleUserMessage(initialState(), "a class", model);
    assert.equal(turn.state.answers.intent, "teach");
  });
});

describe("tapping several choices", () => {
  it("applies the chosen ids exactly", () => {
    const turn = applySelection(atMeasures(), "measures", ["rain", "soil"]);
    assert.deepEqual(turn.state.answers.measures, ["rain", "soil"]);
    assert.equal(turn.asking?.key, "count");
  });

  it("drops ids that are not on the list, and asks for at least one", () => {
    const bad = applySelection(atMeasures(), "measures", ["lava"]);
    assert.equal(bad.understood.length, 0);
    assert.match(bad.reply, /at least one/i);
    const mixed = applySelection(atMeasures(), "measures", ["lava", "wind"]);
    assert.deepEqual(mixed.state.answers.measures, ["wind"]);
  });

  it("replaces an earlier answer to the same question", () => {
    const first = applySelection(atMeasures(), "measures", ["rain"]);
    const again = applySelection(first.state, "measures", ["wind", "sun"]);
    assert.deepEqual([...again.state.answers.measures].sort(), ["sun", "wind"]);
  });
});

describe("the wording reader on its own", () => {
  it("splits the include part from the exclusion", () => {
    const parsed = parseSelection("measures", "all of them except air and rain");
    assert.equal(parsed.all, true);
    assert.deepEqual(parsed.exclude.sort(), ["air", "rain"]);
    assert.match(parsed.includeText, /all of them/);
  });

  it("finds nothing in an unrelated message", () => {
    const parsed = parseSelection("measures", "hello there");
    assert.equal(parsed.all, false);
    assert.deepEqual(parsed.exclude, []);
  });
});
