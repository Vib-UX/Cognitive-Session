import assert from "node:assert/strict";
import test from "node:test";
import { centsToUsdc, extraArgsV3, laneForChain } from "./treasury.js";

test("mainnet lanes reject testnets", () => {
  assert.equal(laneForChain(84532), null);
  assert.equal(laneForChain(11155111), null);
  assert.equal(laneForChain(1)?.name, "Ethereum");
  assert.equal(laneForChain(8453)?.name, "Base");
});

test("cents convert to USDC base units", () => {
  assert.equal(centsToUsdc(75), 750_000n);
  assert.throws(() => centsToUsdc(0));
});

test("extra args use the packed CCIP 2.0 v3 wire format", () => {
  assert.equal(extraArgsV3(), "0xa69dd4aa00000000000000000000000000000000");
});
