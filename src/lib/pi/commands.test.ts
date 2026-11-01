import assert from "node:assert/strict";
import { test } from "node:test";
import { adaptCommand, codeDir, configJson, DEFAULTS, validBroker, validHost, validUser } from "./commands.ts";

test("the shipped account needs no path changes", () => {
  assert.equal(adaptCommand({ ...DEFAULTS, user: "ncar" }), null);
});

test("another account rewrites the home path, User= and Group= in the three files", () => {
  const cmd = adaptCommand({ ...DEFAULTS, user: "pouya" })!;
  assert.match(cmd, /s#\/home\/ncar#\/home\/pouya#g/);
  assert.match(cmd, /s#\^User=ncar\$#User=pouya#/);
  assert.match(cmd, /s#\^Group=ncar\$#Group=pouya#/);
  assert.match(cmd, /setup_and_run\.sh lora-gateway\.service deploy\.sh$/);
});

test("the sed expressions really do rewrite the shipped files", () => {
  const service = "User=ncar\nGroup=ncar\nWorkingDirectory=/home/ncar/mesonet-siparcs25/edge-servers\n";
  const out = service
    .replace(/\/home\/ncar/g, "/home/pouya")
    .replace(/^User=ncar$/gm, "User=pouya")
    .replace(/^Group=ncar$/gm, "Group=pouya");
  assert.equal(out, "User=pouya\nGroup=pouya\nWorkingDirectory=/home/pouya/mesonet-siparcs25/edge-servers\n");
  assert.equal(codeDir("pouya"), "/home/pouya/mesonet-siparcs25/edge-servers");
});

test("the generated pi_config.json parses and keeps the shipped radio settings", () => {
  const cfg = JSON.parse(configJson({ ...DEFAULTS, broker: "mqtt.example.org", port: 8883, edgeId: "roof-pi" }));
  assert.equal(cfg.mqtt.broker_ip, "mqtt.example.org");
  assert.equal(cfg.mqtt.broker_port, 8883);
  assert.equal(cfg.mqtt.msg_topic_template, "sensors/{station_id}");
  assert.equal(cfg.radio.edge_id, "roof-pi");
  assert.equal(cfg.radio.overload_threshold, 0.85);
});

test("input checks reject anything that would break out of a shell command", () => {
  assert.ok(validUser("pouya") && validUser("lora_gw-1"));
  assert.ok(!validUser("Bad Name") && !validUser("a;rm -rf /") && !validUser("") && !validUser("1abc"));
  assert.ok(validHost("lora-gateway") && !validHost("a b") && !validHost("a;b"));
  assert.ok(validBroker("iotwx.ucar.edu") && validBroker("10.0.0.5") && !validBroker("x;y") && !validBroker("a b"));
});
