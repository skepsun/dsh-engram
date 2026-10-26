import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCheck } from "../src/codec.js";

// The check character is `charset[sum(digit*3+7) % 36]` over the decimal digits,
// output as `<input>-<check>`. Nothing in the repo says this — it is a team
// convention that only exists in memory.
test("appends the weighted-digit check character", () => {
  assert.equal(encodeCheck("1234"), "1234-m"); // 1*3+7 + 2*3+7 + 3*3+7 + 4*3+7 = 58; 58 % 36 = 22; charset[22] = "m"
  assert.equal(encodeCheck("0"), "0-7"); // 0*3+7 = 7; 7 % 36 = 7; charset[7] = "7"
  assert.equal(encodeCheck("99"), "99-w"); // 9*3+7 = 34 twice = 68; 68 % 36 = 32; charset[32] = "w"
});
