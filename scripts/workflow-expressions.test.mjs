import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// GitHub Actions only knows these functions inside ${{ ... }}. Anything else (split, replace, lower, ...) makes GitHub
// reject the WHOLE workflow file with "No jobs were run", and nothing can run to say so. This catches it before a push.
const FUNCTIONS = new Set(["contains", "startsWith", "endsWith", "format", "join", "toJSON", "fromJSON", "hashFiles", "success", "always", "cancelled", "failure"]);

const dir = ".github/workflows";
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

test("there is at least one workflow to check", () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`${file}: every function in an expression is one GitHub Actions has`, () => {
    const text = readFileSync(join(dir, file), "utf8");
    const unknown = [];
    for (const [, expression] of text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      // Ignore text inside quotes ('ghcr.io/{0}/x'); look only at what is outside it.
      const code = expression.replace(/'(?:[^']|'')*'/g, "''");
      for (const [, name] of code.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
        if (!FUNCTIONS.has(name)) unknown.push(name);
      }
    }
    assert.deepEqual(unknown, [], `unknown function(s) in an expression: ${unknown.join(", ")}`);
  });

  test(`${file}: no expression is left open`, () => {
    const text = readFileSync(join(dir, file), "utf8");
    assert.equal((text.match(/\$\{\{/g) ?? []).length, (text.match(/\}\}/g) ?? []).length);
  });
}

// An action from outside GitHub and Docker runs with access to the build, and a tag can be moved after the fact.
// So anything else must be pinned to a full commit, which cannot.
const TRUSTED_OWNERS = new Set(["actions", "docker"]);
for (const file of files) {
  test(`${file}: third-party actions are pinned to a full commit`, () => {
    const text = readFileSync(join(dir, file), "utf8");
    const loose = [];
    for (const [, ref] of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
      const [name, version = ""] = ref.split("@");
      if (name.startsWith("./")) continue;
      if (TRUSTED_OWNERS.has(name.split("/")[0])) continue;
      if (!/^[0-9a-f]{40}$/.test(version)) loose.push(ref);
    }
    assert.deepEqual(loose, [], `pin these to a full commit: ${loose.join(", ")}`);
  });
}
