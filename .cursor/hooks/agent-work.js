/**
 * Shared by the prompt and stop hooks. Marks whether the agent turn is open.
 * The extension reads ~/.session/agent-work.json and only counts puzzle
 * rewards while phase is "working".
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const file = path.join(os.homedir(), ".session", "agent-work.json");

function writePhase(phase) {
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    prev = {};
  }
  const previous = Number(prev.generation) || 0;
  const generation = phase === "working" ? previous + 1 : previous;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      phase,
      generation,
      at: Date.now(),
    }),
  );
}

module.exports = { writePhase };
