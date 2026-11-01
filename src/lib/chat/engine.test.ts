import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleUserMessage,
  initialState,
  nextField,
  summarize,
  validateExtraction,
} from "./engine.ts";
import type { Extractor } from "./engine.ts";
import { matchCount } from "./keywords.ts";
import { buildSystemPrompt, parseJsonReply } from "./llm.ts";
import { recommend } from "../wizard/recommend.ts";

async function say(state = initialState(), ...messages: string[]) {
  let current = state;
  let last;
  for (const message of messages) {
    last = await handleUserMessage(current, message);
    current = last.state;
  }
  return { state: current, last: last! };
}

describe("keyword fallback (no model)", () => {
  it("walks the decision tree from plain answers", async () => {
    const { state } = await say(
      initialState(),
      "I want to learn how to build one",
      "In my garden",
      "solar panel",
      "wifi",
      "rain and soil moisture",
      "just one",
    );
    assert.equal(state.answers.intent, "bench");
    assert.equal(state.answers.place, "farm");
    assert.equal(state.answers.power, "solar");
    assert.equal(state.answers.link, "wifi");
    assert.deepEqual(state.answers.measures.sort(), ["rain", "soil"]);
    assert.equal(state.answers.count, 1);
  });

  it("skips the community questions on the bench path and goes straight to the name", async () => {
    const { state } = await say(
      initialState(),
      "learn to build",
      "indoors",
      "outlet",
      "wifi",
      "temperature",
      "one",
    );
    assert.equal(nextField(state)?.key, "siteName");
  });

  it("reads 'none' as no connection on the link question, not as a skip", async () => {
    const { state } = await say(initialState(), "a class", "indoors", "outlet", "none of these");
    assert.equal(state.answers.link, "lora");
  });

  it("lets optional questions be skipped", async () => {
    const { state } = await say(
      initialState(),
      "my community",
      "around town",
      "outlet",
      "wi-fi",
      "rainfall",
      "three",
      "skip",
      "skip",
      "skip",
      "skip",
      "Ridge North",
    );
    assert.equal(nextField(state), null);
    assert.equal(state.siteName, "Ridge North");
  });

  it("asks again, with the same question, when it cannot match", async () => {
    const { last, state } = await say(initialState(), "hmm banana");
    assert.equal(last.understood.length, 0);
    assert.equal(nextField(state)?.key, "intent");
    assert.match(last.reply, /not sure how to match/i);
  });

  it("buckets counts into the wizard's sizes", () => {
    assert.equal(matchCount("1"), 1);
    assert.equal(matchCount("about 3"), 3);
    assert.equal(matchCount("a dozen"), 6);
    assert.equal(matchCount("lots"), null);
  });

  it("a finished chat produces answers the recommender accepts", async () => {
    const { state } = await say(
      initialState(),
      "learn to build",
      "at my home",
      "wall outlet",
      "wifi",
      "temperature and humidity",
      "one",
      "skip",
    );
    const result = recommend(state.answers);
    assert.equal(result.configId, "A");
    assert.ok(summarize(state).length >= 6);
  });
});

describe("model extraction", () => {
  it("fills several fields from one free-text message", async () => {
    const extract: Extractor = async () => ({
      place: "farm",
      power: "solar",
      link: "lora",
      measures: ["rain", "soil"],
    });
    const turn = await handleUserMessage(initialState(), "A farm, no outlet or signal", extract);
    assert.equal(turn.usedModel, true);
    assert.equal(turn.state.answers.place, "farm");
    assert.equal(turn.state.answers.power, "solar");
    assert.deepEqual(turn.state.answers.measures, ["rain", "soil"]);
    // The intent is still missing, so that is what gets asked.
    assert.equal(turn.asking?.key, "intent");
  });

  it("drops invented ids so a model cannot leave the decision tree", () => {
    const clean = validateExtraction({
      answers: { place: "moon base", power: "solar", measures: ["rain", "lava"], count: "2" },
    });
    assert.deepEqual(clean, { power: "solar", measures: ["rain"], count: 3 });
  });

  it("falls back to keywords when the model returns nothing usable", async () => {
    const extract: Extractor = async () => ({ place: "moon base" });
    const turn = await handleUserMessage(initialState(), "a classroom", extract);
    assert.equal(turn.usedModel, false);
    assert.equal(turn.state.answers.intent, "teach");
  });

  it("treats a model that throws or is unreachable like no model", async () => {
    const boom: Extractor = async () => {
      throw new Error("network");
    };
    const down: Extractor = async () => null;
    for (const extract of [boom, down]) {
      const turn = await handleUserMessage(initialState(), "learn to build", extract);
      assert.equal(turn.state.answers.intent, "bench");
    }
  });

  it("answering the question just asked replaces a list, a passing mention adds to it", async () => {
    const first: Extractor = async () => ({ measures: ["rain"] });
    let turn = await handleUserMessage(
      {
        ...initialState(),
        answers: {
          ...initialState().answers,
          intent: "bench",
          place: "home",
          power: "outlet",
          link: "wifi",
        },
      },
      "rain",
      first,
    );
    assert.deepEqual(turn.state.answers.measures, ["rain"]);
    turn = await handleUserMessage(turn.state, "actually wind", async () => ({
      measures: ["wind"],
    }));
    assert.deepEqual(turn.state.answers.measures.sort(), ["rain", "wind"]);
  });
});

describe("model plumbing", () => {
  it("parses JSON out of a chatty reply", () => {
    assert.deepEqual(parseJsonReply('Sure! ```json\n{"place":"farm"}\n``` hope that helps'), {
      place: "farm",
    });
    assert.equal(parseJsonReply("no json here"), null);
  });

  it("lists every wizard choice id in the prompt", () => {
    const prompt = buildSystemPrompt("place");
    for (const id of ["indoors", "farm", "solar", "poe", "lora", "soil", "co2"]) {
      assert.ok(prompt.includes(id), `${id} missing from the prompt`);
    }
    assert.ok(prompt.includes('just asked about "place"'));
  });
});
