import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalizeLiftosaurSource,
  normalizeLineEndings,
} from "./source-format.mjs";

const STATE_MARKER = "__LIFTOSAUR_CI_STATE__";
const STATE_VALUE = "__LIFTOSAUR_CI_STATE_VALUE__";
const STATEMENT_MARKER = "__LIFTOSAUR_CI_STATEMENT__";
const SECTION_MARKER = "__LIFTOSAUR_CI_SECTION__";
const SECTION_VALUE = "__LIFTOSAUR_CI_SECTION_VALUE__";
const STATEMENT_END = "__LIFTOSAUR_CI_STATEMENT_END__";
export const BLOCK_MARKER = "__LIFTOSAUR_CI_BLOCK__";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(sourceDirectory);
const pinnedRuntimeRevision = readFileSync(
  path.join(repositoryRoot, "runtime", "liftosaur.version"),
  "utf8"
).trim();

export const LIFTOSAUR_MERGE_FRONTEND = Object.freeze({
  formatVersion: 1,
  implementation: "liftosaur-parser-v1",
  runtimeRevision: pinnedRuntimeRevision,
});

let plannerParser;

function loadPlannerParser() {
  if (plannerParser) return plannerParser;
  const runtime = path.resolve(
    process.env.LIFTOSAUR_RUNTIME
      ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
  );
  const packageFile = path.join(runtime, "package.json");
  const parserFile = path.join(runtime, "src", "pages", "planner", "plannerExerciseParser.ts");
  if (!existsSync(packageFile) || !existsSync(parserFile)) {
    throw new Error(
      `Pinned Liftosaur parser runtime is unavailable at ${runtime}; run npm run setup:runtime`
    );
  }
  const revision = spawnSync(
    "git",
    ["-c", `safe.directory=${runtime}`, "-C", runtime, "rev-parse", "HEAD"],
    { encoding: "utf8", windowsHide: true }
  );
  if (revision.status !== 0 || revision.stdout.trim() !== pinnedRuntimeRevision) {
    throw new Error(`Liftosaur parser runtime must be pinned at ${pinnedRuntimeRevision}`);
  }
  const runtimeRequire = createRequire(packageFile);
  runtimeRequire("ts-node/register");
  plannerParser = runtimeRequire(parserFile).parser;
  return plannerParser;
}

function parsePlannerSyntax(source) {
  const parser = loadPlannerParser();
  const tree = parser.parse(source);
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) {
      throw new Error(`Liftosaur parser rejected source at offset ${cursor.from}`);
    }
  } while (cursor.next());
  return tree.topNode;
}

function nodeText(source, node) {
  return source.slice(node.from, node.to);
}

function exercisePropertyName(source, section) {
  const property = section.getChild("ExerciseProperty");
  const name = property?.getChild("ExercisePropertyName");
  return name ? nodeText(source, name) : undefined;
}

function exerciseFunctionName(source, section) {
  const fn = section.getChild("ExerciseProperty")?.getChild("FunctionExpression");
  const name = fn?.getChild("FunctionName");
  return name ? nodeText(source, name) : undefined;
}

function parseStateArguments(argumentsText) {
  const state = new Map();
  const trimmed = argumentsText.trim();
  if (!trimmed) return state;

  for (const item of trimmed.split(",")) {
    const separator = item.indexOf(":");
    if (separator <= 0) {
      throw new Error(`Unsupported progress: custom(...) state item: ${item.trim()}`);
    }
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*\+?$/.test(key) || !value) {
      throw new Error(`Unsupported progress: custom(...) state item: ${item.trim()}`);
    }
    if (state.has(key)) throw new Error(`Duplicate progress state variable: ${key}`);
    if (value.includes("\n")) {
      throw new Error(`Multiline progress state values are not supported yet: ${key}`);
    }
    state.set(key, value);
  }
  return state;
}

function splitTopLevelSections(line) {
  const sections = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "{") curly += 1;
    else if (character === "}") curly -= 1;
    if (
      round === 0
      && square === 0
      && curly === 0
      && line.slice(index, index + 3) === " / "
    ) {
      sections.push(line.slice(start, index).trim());
      start = index + 3;
      index += 2;
    }
  }
  sections.push(line.slice(start).trim());
  return sections;
}

function sectionKey(section, bareIndex) {
  if (section.startsWith("...")) return "inherit";
  const label = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(section)?.[1];
  return label ? `property:${label}` : `prescription:${bareIndex}`;
}

function projectStructuredStatements(source) {
  const lines = source.split("\n");
  let week = "";
  let day = "";
  let statementCount = 0;
  const identities = new Map();
  const projected = [];

  for (const line of lines) {
    if (line.startsWith("# ")) week = line.slice(2).trim();
    if (line.startsWith("## ")) day = line.slice(3).trim();
    if (line.startsWith(" ") || !line.includes("progress: custom(")) {
      projected.push(line);
      continue;
    }
    const sections = splitTopLevelSections(line);
    if (sections.length < 2) {
      projected.push(line);
      continue;
    }

    const identityBase = JSON.stringify([week, day, sections[0]]);
    const occurrence = (identities.get(identityBase) ?? 0) + 1;
    identities.set(identityBase, occurrence);
    const identity = JSON.stringify([week, day, sections[0], occurrence]);
    const keyCounts = new Map();
    let bareIndex = 0;
    statementCount += 1;
    projected.push(`${STATEMENT_MARKER} ${identity}`);
    for (let index = 0; index < sections.length; index += 1) {
      let key = index === 0 ? "identity" : sectionKey(sections[index], bareIndex);
      if (key.startsWith("prescription:")) bareIndex += 1;
      const count = (keyCounts.get(key) ?? 0) + 1;
      keyCounts.set(key, count);
      if (count > 1) key = `${key}#${count}`;
      projected.push(`${SECTION_MARKER} ${key}`);
      projected.push(`${SECTION_VALUE} ${sections[index]}`);
    }
    projected.push(`${STATEMENT_END} ${identity}`);
  }
  return { source: projected.join("\n"), statementCount };
}

function restoreStructuredStatements(source) {
  const lines = source.split("\n");
  const restored = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith(`${STATEMENT_MARKER} `)) {
      restored.push(line);
      continue;
    }
    const identity = line.slice(STATEMENT_MARKER.length + 1);
    const sections = [];
    index += 1;
    while (index < lines.length && lines[index] !== `${STATEMENT_END} ${identity}`) {
      const section = lines[index];
      if (!section.startsWith(`${SECTION_MARKER} `)) {
        throw new Error(`Projected statement section could not be restored: ${identity}`);
      }
      index += 1;
      if (!lines[index]?.startsWith(`${SECTION_VALUE} `)) {
        throw new Error(`Projected statement section value is missing: ${identity}`);
      }
      sections.push(lines[index].slice(SECTION_VALUE.length + 1));
      index += 1;
    }
    if (index >= lines.length) {
      throw new Error(`Projected statement end is missing: ${identity}`);
    }
    restored.push(sections.join(" / "));
  }
  return restored.join("\n");
}

export function parseLiftosaurMergeDocument(source) {
  const normalized = normalizeLineEndings(source);
  const root = parsePlannerSyntax(normalized);
  const manifest = [];
  const order = [];
  const blocks = new Map();
  let pending = [];
  let week = "";
  let day = "";

  function flushPending() {
    manifest.push(...pending);
    pending = [];
  }

  function addBlock(key, content) {
    if (blocks.has(key)) {
      const kind = JSON.parse(key)[0];
      throw new Error(`Duplicate Liftosaur ${kind} identity: ${key}`);
    }
    blocks.set(key, {
      prefix: pending.join("\n").trim(),
      body: content,
    });
    pending = [];
    manifest.push(`${BLOCK_MARKER} ${key}`);
    order.push(`${BLOCK_MARKER} ${key}`);
  }

  for (let node = root.firstChild; node; node = node.nextSibling) {
    const type = node.type.name;
    const text = nodeText(normalized, node).trimEnd();
    if (type === "Week" || type === "Day") {
      flushPending();
      manifest.push(text);
      if (type === "Week") {
        week = text.slice(1).trim();
        day = "";
      } else {
        day = text.slice(2).trim();
      }
      continue;
    }
    if (type === "EmptyExpression" || type === "LineComment" || type === "TripleLineComment") {
      pending.push(text);
      continue;
    }
    if (type !== "ExerciseExpression") {
      throw new Error(`Unsupported Liftosaur parser node: ${type}`);
    }

    const variations = node.getChild("ExerciseVariations");
    const label = variations ? nodeText(normalized, variations).trim() : "";
    const sections = node.getChildren("ExerciseSection");
    const isProgressStatement = sections.some((section) => (
      exercisePropertyName(normalized, section) === "progress"
      && exerciseFunctionName(normalized, section) === "custom"
    ));
    if (isProgressStatement) {
      addBlock(JSON.stringify(["statement", week, day, label]), text);
      continue;
    }
    const isDefinition = /^[A-Za-z][A-Za-z0-9_-]*$/.test(label)
      && sections.some((section) => exercisePropertyName(normalized, section) === "update");
    if (isDefinition) {
      addBlock(JSON.stringify(["definition", week, label]), text);
      continue;
    }
    flushPending();
    manifest.push(text);
  }

  flushPending();
  return {
    frontend: LIFTOSAUR_MERGE_FRONTEND,
    manifest: manifest.join("\n"),
    order: order.join("\n"),
    blocks,
  };
}

export function projectLiftosaurSource(source) {
  const normalized = normalizeLineEndings(source);
  if ([
    STATE_MARKER,
    STATE_VALUE,
    STATEMENT_MARKER,
    SECTION_MARKER,
    SECTION_VALUE,
    STATEMENT_END,
    BLOCK_MARKER,
  ].some((marker) => normalized.includes(marker))) {
    throw new Error("Liftosaur source contains a reserved merge marker");
  }

  const structured = projectStructuredStatements(normalized);
  const stateOrders = [];
  let stateBlockCount = 0;
  const projected = structured.source.replace(
    /progress:\s*custom\(([^)]*)\)/g,
    (_match, argumentsText) => {
      const parsedState = parseStateArguments(argumentsText);
      if (parsedState.size === 0) return "progress: custom()";
      stateBlockCount += 1;
      stateOrders.push([...parsedState.keys()]);
      const state = [...parsedState.entries()]
        .sort(([left], [right]) => left.localeCompare(right));
      const lines = state.flatMap(([key, value]) => [
        `${STATE_MARKER} ${key}`,
        `${STATE_VALUE} ${value}`,
      ]);
      return `progress: custom(\n${lines.join("\n")}\n)`;
    }
  );
  return {
    frontend: LIFTOSAUR_MERGE_FRONTEND,
    source: projected,
    stateBlockCount,
    stateOrders,
    statementCount: structured.statementCount,
  };
}

export function restoreProjectedSource(source, preferredOrders = []) {
  const normalized = normalizeLineEndings(source);
  let stateBlockIndex = 0;
  const restored = normalized.replace(
    /progress:\s*custom\(\n((?:(?:__LIFTOSAUR_CI_STATE__|__LIFTOSAUR_CI_STATE_VALUE__) [^\n]+\n)+)\)/g,
    (_match, body) => {
      const lines = body.trimEnd().split("\n");
      const byKey = new Map();
      for (let index = 0; index < lines.length; index += 2) {
        if (!lines[index]?.startsWith(`${STATE_MARKER} `)
          || !lines[index + 1]?.startsWith(`${STATE_VALUE} `)) {
          throw new Error("Projected merge state has an invalid key/value pair");
        }
        const key = lines[index].slice(STATE_MARKER.length + 1);
        const value = lines[index + 1].slice(STATE_VALUE.length + 1);
        byKey.set(key, `${key}: ${value}`);
      }
      const preferred = preferredOrders[stateBlockIndex] ?? [];
      stateBlockIndex += 1;
      const ordered = [];
      for (const key of preferred) {
        if (byKey.has(key)) {
          ordered.push(byKey.get(key));
          byKey.delete(key);
        }
      }
      ordered.push(...byKey.values());
      return `progress: custom(${ordered.join(", ")})`;
    }
  );
  if (restored.includes(STATE_MARKER) || restored.includes(STATE_VALUE)) {
    throw new Error("Projected merge state could not be restored");
  }
  return canonicalizeLiftosaurSource(restoreStructuredStatements(restored));
}
