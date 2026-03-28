import test from "node:test";
import assert from "node:assert/strict";
import {
  bitwiseCalculate,
  caesarShift,
  convertBase,
  frequencyAnalyze,
  hashText,
  runEncodingChain,
  subnetDetails,
  toHexView
} from "../src/utils/toolHelpers.js";

if (!globalThis.btoa) {
  globalThis.btoa = (input) => Buffer.from(input, "binary").toString("base64");
}
if (!globalThis.atob) {
  globalThis.atob = (input) => Buffer.from(input, "base64").toString("binary");
}

test("caesarShift decodes with provided shift", () => {
  assert.equal(caesarShift("KHOOR", 3), "HELLO");
});

test("convertBase converts between bases", () => {
  assert.equal(convertBase("ff", 16, 10), "255");
});

test("runEncodingChain supports base64 encode", () => {
  assert.equal(runEncodingChain("hi", "base64-encode"), "aGk=");
});

test("frequencyAnalyze counts symbols", () => {
  const output = frequencyAnalyze("abba");
  assert.match(output, /a: 2/);
  assert.match(output, /b: 2/);
});

test("hashText returns deterministic sha256", () => {
  assert.equal(hashText("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("subnetDetails parses CIDR", () => {
  const output = subnetDetails("10.0.0.3/24");
  assert.match(output, /network: 10.0.0.0/);
  assert.match(output, /broadcast: 10.0.0.255/);
});

test("bitwiseCalculate applies xor", () => {
  const output = bitwiseCalculate(5, "xor", 3);
  assert.match(output, /^6/);
});

test("toHexView converts text", () => {
  assert.equal(toHexView("AB"), "41 42");
});
