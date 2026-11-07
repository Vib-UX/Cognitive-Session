#!/usr/bin/env node
/**
 * When the agent turn ends, puzzle credits earned during it become claimable.
 * Fails open and never asks the agent to continue.
 */
const { writePhase } = require("./agent-work.js");

function finish() {
  process.stdout.write("{}\n");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  void input;
  try {
    writePhase("done");
  } catch {
    /* leave the turn alone */
  }
  finish();
});
