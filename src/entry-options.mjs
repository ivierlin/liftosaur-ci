import path from "node:path";

export function extractConflictOutput(args) {
  const command = args[0];
  const indexes = args
    .map((value, index) => value === "--conflict-output" ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length === 0) return { args, conflictOutput: null };
  if (indexes.length > 1) throw new Error("Duplicate option: --conflict-output");
  if (command !== "prepare" && command !== "prepare-git") {
    throw new Error("--conflict-output is only valid with prepare or prepare-git");
  }
  const index = indexes[0];
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Missing value for --conflict-output");
  }
  return {
    args: [...args.slice(0, index), ...args.slice(index + 2)],
    conflictOutput: path.resolve(value),
  };
}
