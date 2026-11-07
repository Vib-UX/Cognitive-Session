#!/usr/bin/env node
/**
 * When the user prompts the agent, queue the next selected puzzle.
 * The Session extension watches ~/.session/puzzle-trigger.json.
 * Fails open: a bad prefs file never blocks the prompt.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writePhase } = require("./agent-work.js");

const dir = path.join(os.homedir(), ".session");
const prefsPath = path.join(dir, "prefs.json");
const turnPath = path.join(dir, "puzzle-turn.json");
const triggerPath = path.join(dir, "puzzle-trigger.json");

function finish() {
  process.stdout.write("{}\n");
}

function trigger() {
  try {
    if (!fs.existsSync(prefsPath)) return;
    const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
    const games = Array.isArray(prefs.games) ? prefs.games.filter((game) => typeof game === "string") : [];
    if (!prefs.onboarded || games.length === 0) return;
    let index = 0;
    if (fs.existsSync(turnPath)) {
      const turn = JSON.parse(fs.readFileSync(turnPath, "utf8"));
      index = Number(turn.i) || 0;
    }
    const picked = games[index % games.length];
    const game = picked === "snakes" ? "flappy" : picked;
    fs.mkdirSync(dir, { recursive: true });
    writePhase("working");
    fs.writeFileSync(turnPath, JSON.stringify({ i: index + 1 }));
    fs.writeFileSync(triggerPath, JSON.stringify({ at: Date.now(), game }));
  } catch {
    /* leave the prompt alone */
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  void input;
  trigger();
  finish();
});
