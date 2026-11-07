import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type WebSocket from "ws";
import { BASE_CCIP_TX_URL, PlayBank, STAKE_USDC, depositFromBlock, formatUsdc, logRanges, logSpan, transferHref, transferLine } from "./bank.js";
import { RelayStore } from "./store.js";
import type { ServerMessage, SessionId } from "./types.js";

const ADA = `0x${"11".repeat(20)}` as const;
const BOB = `0x${"22".repeat(20)}` as const;
const ADA_TX = `0x${"ab".repeat(32)}`;
const BOB_TX = `0x${"cd".repeat(32)}`;
const A = "sess_bank_a" as SessionId;
const B = "sess_bank_b" as SessionId;

function fakeSocket() {
  const sent: ServerMessage[] = [];
  const ws = {
    send(raw: string) {
      sent.push(JSON.parse(raw) as ServerMessage);
    },
    close() {},
  };
  return { ws: ws as unknown as WebSocket, sent };
}

function last<T extends ServerMessage["type"]>(sent: ServerMessage[], type: T) {
  const found = [...sent].reverse().find((msg) => msg.type === type);
  assert.ok(found, `expected ${type}`);
  return found as Extract<ServerMessage, { type: T }>;
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

test("a $1 deposit stays playable, and two losses leave $0.90", async () => {
  const bank = new PlayBank(null, async () => [{ txHash: ADA_TX, amount: 1_000_000n }]);
  const store = new RelayStore({ bank });
  const ada = fakeSocket();
  store.add(ada.ws);
  store.handle(ada.ws, JSON.stringify({
    type: "hello",
    identity: { id: A, displayName: "ada", host: "cursor", walletAddress: ADA, chainId: 8453 },
  }));
  await settled();
  const view = last(ada.sent, "bank").bank;
  assert.equal(view.balanceUsd, "$1.00");
  assert.equal(view.canPlay, true);
  assert.equal(bank.balanceOf(ADA, 8453), 1_000_000n);
  assert.equal(bank.take(ADA, BOB, STAKE_USDC, 8453, 8453), true);
  assert.equal(bank.take(ADA, BOB, STAKE_USDC, 8453, 8453), true);
  assert.equal(bank.balanceOf(ADA, 8453), 900_000n);
  assert.equal(formatUsdc(bank.balanceOf(ADA, 8453)), "$0.90");
});

test("a deposit from earlier the same day is still inside the scan window", () => {
  const latest = 54_178_661n;
  const headTime = 1_700_000_000n;
  const sampleBlock = latest - 2_000n;
  const sampleTime = headTime - 400n;
  const from = depositFromBlock(latest, headTime, sampleBlock, sampleTime);
  const depositedAt = 54_133_873n;
  assert.ok(from < depositedAt);
  assert.ok(latest - from >= 49_000n);
});

test("optimism log pages stay inside the 10,000 block RPC limit", () => {
  assert.ok(logSpan(10) <= 10_000n);
  assert.equal(logSpan(8453), 49_000n);
  const latest = 1_000_000n;
  const from = latest - 130_000n;
  const depositedAt = latest - 5_620n;
  const ranges = logRanges(from, latest, logSpan(10));
  assert.ok(ranges.length > 1);
  assert.equal(ranges[0]?.from, from);
  assert.equal(ranges[ranges.length - 1]?.to, latest);
  for (const range of ranges) {
    assert.ok(range.to - range.from + 1n <= 10_000n);
    assert.ok(range.to >= range.from);
  }
  assert.ok(ranges.some((range) => depositedAt >= range.from && depositedAt <= range.to));
  assert.equal(formatUsdc(1_200_000n), "$1.20");
});

test("a dollar formats as $1.00 and a game as $0.05", () => {
  assert.equal(formatUsdc(1_000_000n), "$1.00");
  assert.equal(formatUsdc(STAKE_USDC), "$0.05");
  assert.equal(formatUsdc(1_050_000n), "$1.05");
  assert.equal(
    transferLine("won", "Optimism", "Base"),
    `CCIP transaction: cross-chain transfer from their Optimism to your Base. ${BASE_CCIP_TX_URL}`,
  );
  assert.equal(transferHref("Optimism", "Base"), BASE_CCIP_TX_URL);
  assert.equal(transferHref("Ethereum", "Polygon"), null);
  assert.equal(
    transferLine("lost", "Base", "Optimism"),
    `CCIP transaction: cross-chain transfer from your Base to their Optimism. ${BASE_CCIP_TX_URL}`,
  );
});

test("a deposit is credited once and a short balance does not move", () => {
  const bank = new PlayBank(null, async () => []);
  assert.equal(bank.credit(ADA, ADA_TX, 1_000_000n), true);
  assert.equal(bank.credit(ADA, ADA_TX, 1_000_000n), false);
  assert.equal(bank.balanceOf(ADA), 1_000_000n);
  assert.equal(bank.take(ADA, BOB, STAKE_USDC), true);
  assert.equal(bank.balanceOf(ADA), 950_000n);
  assert.equal(bank.balanceOf(BOB), STAKE_USDC);
  assert.equal(bank.take(ADA, ADA, STAKE_USDC), false);
  assert.equal(bank.take(BOB, ADA, 1_000_000n), false);
  assert.equal(bank.balanceOf(BOB), STAKE_USDC);
});

test("claim holds the balance until it is finished or restored", () => {
  const bank = new PlayBank(null, async () => []);
  bank.credit(ADA, ADA_TX, 1_000_000n);
  assert.equal(bank.reserveClaim(ADA), 1_000_000n);
  assert.equal(bank.balanceOf(ADA), 0n);
  assert.throws(() => bank.reserveClaim(ADA), /in progress/);
  bank.restore(ADA, 1_000_000n);
  assert.equal(bank.balanceOf(ADA), 1_000_000n);
  assert.equal(bank.reserveClaim(ADA), 1_000_000n);
  bank.finishClaim(ADA);
  assert.equal(bank.balanceOf(ADA), 0n);
});

test("a Base balance does not include an Optimism deposit", () => {
  const bank = new PlayBank(null, async () => []);
  assert.equal(bank.credit(ADA, ADA_TX, 1_000_000n, 8453), true);
  assert.equal(bank.credit(ADA, BOB_TX, 1_200_000n, 10), true);
  assert.equal(bank.balanceOf(ADA, 8453), 1_000_000n);
  assert.equal(bank.balanceOf(ADA, 10), 1_200_000n);
});

test("the bank file remembers a deposit across opens", () => {
  const dir = mkdtempSync(join(tmpdir(), "session-bank-"));
  const file = join(dir, "bank.json");
  const first = PlayBank.open(file);
  first.credit(ADA, ADA_TX, 1_000_000n);
  const second = PlayBank.open(file);
  assert.equal(second.balanceOf(ADA), 1_000_000n);
  assert.equal(second.credit(ADA, ADA_TX, 1_000_000n), false);
});

test("flappy moves $0.05 from the loser chain balance to the winner", () => {
  const bank = new PlayBank(null, async () => []);
  bank.credit(ADA, ADA_TX, 1_000_000n, 8453);
  bank.credit(BOB, BOB_TX, 1_000_000n, 10);
  const store = new RelayStore({ bank });
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({
    type: "hello",
    identity: { id: A, displayName: "ada", host: "cursor", walletAddress: ADA, chainId: 8453 },
  }));
  store.handle(bob.ws, JSON.stringify({
    type: "hello",
    identity: { id: B, displayName: "bob", host: "claude", walletAddress: BOB, chainId: 10 },
  }));
  store.handle(ada.ws, JSON.stringify({ type: "flappy_join" }));
  store.handle(bob.ws, JSON.stringify({ type: "flappy_join" }));
  const start = last(ada.sent, "flappy");
  store.handle(ada.ws, JSON.stringify({ type: "flappy_score", contestId: start.flappy.id, score: 4 }));
  store.handle(bob.ws, JSON.stringify({ type: "flappy_score", contestId: start.flappy.id, score: 2 }));

  assert.equal(bank.balanceOf(ADA, 8453), 1_050_000n);
  assert.equal(bank.balanceOf(BOB, 10), 950_000n);
  const adaBank = last(ada.sent, "bank");
  const bobBank = last(bob.sent, "bank");
  assert.equal(adaBank.bank.balanceUsd, "$1.05");
  assert.equal(adaBank.bank.note, "Balance updated. Claim it whenever you want.");
  assert.equal(last(ada.sent, "flappy").flappy.balanceUsd, "$1.05");
  assert.equal(last(bob.sent, "flappy").flappy.balanceUsd, "$0.95");
  assert.equal(adaBank.bank.depositUsd, "$1.00");
  assert.equal(adaBank.bank.transfer?.line, `CCIP transaction: cross-chain transfer from their Optimism to your Base. ${BASE_CCIP_TX_URL}`);
  assert.equal(adaBank.bank.transfer?.href, BASE_CCIP_TX_URL);
  assert.equal(bobBank.bank.transfer?.line, `CCIP transaction: cross-chain transfer from your Optimism to their Base. ${BASE_CCIP_TX_URL}`);
  assert.equal(last(ada.sent, "flappy").flappy.stake, `CCIP transaction: cross-chain transfer from their Optimism to your Base. ${BASE_CCIP_TX_URL}`);
});

test("a game without a deposit asks for $1.00 and leaves balances alone", () => {
  const bank = new PlayBank(null, async () => []);
  const store = new RelayStore({ bank });
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({
    type: "hello",
    identity: { id: A, displayName: "ada", host: "cursor", walletAddress: ADA, chainId: 8453 },
  }));
  store.handle(bob.ws, JSON.stringify({
    type: "hello",
    identity: { id: B, displayName: "bob", host: "claude", walletAddress: BOB, chainId: 42161 },
  }));
  store.handle(ada.ws, JSON.stringify({ type: "flappy_join" }));
  store.handle(bob.ws, JSON.stringify({ type: "flappy_join" }));
  const start = last(ada.sent, "flappy");
  store.handle(ada.ws, JSON.stringify({ type: "flappy_score", contestId: start.flappy.id, score: 3 }));
  store.handle(bob.ws, JSON.stringify({ type: "flappy_score", contestId: start.flappy.id, score: 1 }));
  assert.equal(bank.balanceOf(ADA), 0n);
  assert.equal(bank.balanceOf(BOB), 0n);
  assert.equal(last(ada.sent, "bank").bank.transfer?.line, "Deposit $1.00 USDC to cover the $0.05.");
});

test("chess resign moves $0.05 to the player who stays", () => {
  const bank = new PlayBank(null, async () => []);
  bank.credit(ADA, ADA_TX, 1_000_000n, 1);
  bank.credit(BOB, BOB_TX, 1_000_000n, 137);
  const store = new RelayStore({ bank });
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({
    type: "hello",
    identity: { id: A, displayName: "ada", host: "cursor", walletAddress: ADA, chainId: 1 },
  }));
  store.handle(bob.ws, JSON.stringify({
    type: "hello",
    identity: { id: B, displayName: "bob", host: "cursor", walletAddress: BOB, chainId: 137 },
  }));
  store.handle(ada.ws, JSON.stringify({ type: "challenge", to: B, stakeWei: "0" }));
  const challenge = last(bob.sent, "challenge");
  store.handle(bob.ws, JSON.stringify({ type: "respond_challenge", challengeId: challenge.challenge.id, accept: true }));
  const match = last(ada.sent, "match");
  store.handle(ada.ws, JSON.stringify({ type: "resign", matchId: match.match.matchId }));
  assert.equal(bank.balanceOf(ADA, 1), 950_000n);
  assert.equal(bank.balanceOf(BOB, 137), 1_050_000n);
  assert.equal(last(bob.sent, "bank").bank.balanceUsd, "$1.05");
  assert.equal(last(bob.sent, "bank").bank.canClaim, true);
  assert.equal(last(ada.sent, "bank").bank.balanceUsd, "$0.95");
  assert.equal(last(bob.sent, "bank").bank.note, "Balance updated. Claim it whenever you want.");
  assert.match(last(bob.sent, "bank").bank.transfer?.line ?? "", /\$0\.05 from their Ethereum to your Polygon/);
});

test("a rematch starts only after both players ask, and the claimable balance stays", () => {
  const bank = new PlayBank(null, async () => []);
  bank.credit(ADA, ADA_TX, 1_000_000n, 1);
  bank.credit(BOB, BOB_TX, 1_000_000n, 137);
  const store = new RelayStore({ bank });
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({
    type: "hello",
    identity: { id: A, displayName: "ada", host: "cursor", walletAddress: ADA, chainId: 1 },
  }));
  store.handle(bob.ws, JSON.stringify({
    type: "hello",
    identity: { id: B, displayName: "bob", host: "cursor", walletAddress: BOB, chainId: 137 },
  }));
  store.handle(ada.ws, JSON.stringify({ type: "challenge", to: B, stakeWei: "0" }));
  const challenge = last(bob.sent, "challenge");
  store.handle(bob.ws, JSON.stringify({ type: "respond_challenge", challengeId: challenge.challenge.id, accept: true }));
  const finishedId = last(ada.sent, "match").match.matchId;
  store.handle(ada.ws, JSON.stringify({ type: "resign", matchId: finishedId }));

  store.handle(ada.ws, JSON.stringify({ type: "rematch", game: "chess" }));
  assert.equal(last(ada.sent, "rematch").offer?.waiting, true);
  assert.equal(last(bob.sent, "rematch").offer?.waiting, false);
  assert.equal(last(bob.sent, "rematch").offer?.fromName, "ada");
  assert.equal(last(ada.sent, "match").match.matchId, finishedId);

  store.handle(bob.ws, JSON.stringify({ type: "rematch", game: "chess" }));
  const next = last(ada.sent, "match").match;
  assert.equal(next.status, "active");
  assert.notEqual(next.matchId, finishedId);
  assert.equal(last(ada.sent, "rematch").offer, null);
  assert.equal(bank.balanceOf(ADA, 1), 950_000n);
  assert.equal(bank.balanceOf(BOB, 137), 1_050_000n);
  assert.equal(last(bob.sent, "bank").bank.canClaim, true);
});

test("play stays closed until a Base deposit covers $0.05", () => {
  const bank = new PlayBank(null, async () => []);
  const store = new RelayStore({ bank, requireDeposit: true });
  const ada = fakeSocket();
  store.add(ada.ws);
  store.handle(ada.ws, JSON.stringify({
    type: "hello",
    identity: { id: A, displayName: "ada", host: "claude", walletAddress: ADA, chainId: 1 },
  }));
  assert.equal(last(ada.sent, "bank").bank.canPlay, false);
  store.handle(ada.ws, JSON.stringify({ type: "flappy_join" }));
  assert.match(last(ada.sent, "error").message, /Deposit \$1\.00 USDC on Base or Optimism/);
  store.handle(ada.ws, JSON.stringify({ type: "next" }));
  assert.match(last(ada.sent, "error").message, /Deposit \$1\.00 USDC on Base or Optimism/);
  bank.credit(ADA, ADA_TX, 1_000_000n, 1);
  store.handle(ada.ws, JSON.stringify({ type: "flappy_join" }));
  assert.equal(last(ada.sent, "flappy").flappy.status, "waiting");
});
