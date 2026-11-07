import assert from "node:assert/strict";
import test from "node:test";
import { centsToUsdc, choosePayout, extraArgsV3, laneForChain } from "./treasury.js";

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

test("a claim uses the treasury on that chain, or CCIP from a treasury that can pay", () => {
  const rows = [
    { chainId: 8453, balance: 1_000_000n },
    { chainId: 1, balance: 50_000n },
  ];
  assert.equal(choosePayout(1, rows, 50_000n), 1);
  assert.equal(choosePayout(1, rows, 1_000_000n), 8453);
  assert.equal(choosePayout(42161, rows, 50_000n), 8453);
  assert.equal(choosePayout(137, rows, 2_000_000n), null);
});

test("extra args use the packed CCIP 2.0 v3 wire format", () => {
  assert.equal(extraArgsV3(), "0xa69dd4aa00000000000000000000000000000000");
});
