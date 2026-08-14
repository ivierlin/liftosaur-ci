import {
  canonicalizeLiftosaurSource,
  normalizeLineEndings,
} from "./source-format.mjs";
import { loadLiftosaurRuntime, pinnedRuntimeRevision } from "./runtime.mjs";

const STATEMENT_MARKER = "__LIFTOSAUR_CI_STATEMENT__";
const ATOM_MARKER = "__LIFTOSAUR_CI_ATOM__";
const ATOM_VALUE = "__LIFTOSAUR_CI_ATOM_VALUE__";
const ATOM_END = "__LIFTOSAUR_CI_ATOM_END__";
const STATEMENT_END = "__LIFTOSAUR_CI_STATEMENT_END__";
const INITIALIZATION_STATE = "__LIFTOSAUR_CI_INITIALIZATION_STATE__";
export const BLOCK_MARKER = "__LIFTOSAUR_CI_BLOCK__";

export const LIFTOSAUR_MERGE_FRONTEND = Object.freeze({
  runtimeRevision: pinnedRuntimeRevision,
});

let plannerParser;

function loadPlannerParser() {
  if (plannerParser) return plannerParser;
  plannerParser = loadLiftosaurRuntime().require(
    "src/pages/planner/plannerExerciseParser.ts"
  ).parser;
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

const LIVE_OWNED_PROPERTIES = new Set([
  "amrap",
  "askweight",
  "logrpe",
  "timer",
  "warmup",
]);

function initializationReplacements(source, root) {
  const replacements = [];
  const replace = (from, to, text = INITIALIZATION_STATE) => {
    if (to > from) replacements.push({ from, to, text });
  };

  function visit(current) {
    if (current.type.name === "CurrentVariation" || current.type.name === "Current") {
      const trailing = /^\s*/.exec(source.slice(current.to))?.[0].length ?? 0;
      replace(current.from, current.to + trailing, "");
      return;
    }
    if (current.type.name === "ExerciseSets" || current.type.name === "WarmupExerciseSets") {
      const labels = [];
      const cursor = current.cursor();
      do {
        if (cursor.type.name === "SetLabel") labels.push(nodeText(source, cursor.node));
      } while (cursor.next());
      replace(current.from, current.to, `${INITIALIZATION_STATE}${JSON.stringify(labels)}`);
      return;
    }
    if (current.type.name === "ExerciseProperty") {
      const nameNode = current.getChild("ExercisePropertyName");
      const name = nameNode ? nodeText(source, nameNode) : undefined;
      if (name && LIVE_OWNED_PROPERTIES.has(name)) {
        replace(nameNode.to, current.to, `: ${INITIALIZATION_STATE}`);
        return;
      }
      if (name === "progress") {
        const progressCursor = current.cursor();
        do {
          if (progressCursor.type.name === "FunctionArgument") {
            replace(progressCursor.from, progressCursor.to);
          }
        } while (progressCursor.next());
        return;
      }
    }
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child);
  }

  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.type.name === "ExerciseExpression") visit(node);
    if (node.type.name === "LineComment" || node.type.name === "TripleLineComment") {
      const text = nodeText(source, node);
      const selected = /^(\/\/\/?\s*)!\s/.exec(text);
      if (selected) replace(node.from + selected[1].length, node.from + selected[0].length, "");
    }
  }
  return replacements;
}

export function projectLiftosaurSourceForInitialization(source) {
  const normalized = canonicalizeLiftosaurSource(source);
  if (normalized.includes(INITIALIZATION_STATE)) {
    throw new Error("Liftosaur source contains a reserved initialization marker");
  }
  const root = parsePlannerSyntax(normalized);
  const replacements = initializationReplacements(normalized, root)
    .sort((left, right) => right.from - left.from || right.to - left.to);
  let projected = normalized;
  let previousFrom = normalized.length + 1;
  for (const replacement of replacements) {
    if (replacement.to > previousFrom) continue;
    projected = `${projected.slice(0, replacement.from)}${replacement.text}${projected.slice(replacement.to)}`;
    previousFrom = replacement.from;
  }
  return projected;
}

function exerciseVariationsIdentity(source, variations) {
  if (!variations) return "";
  return variations.getChildren("ExerciseVariation")
    .map((variation) => variation.getChild("ExerciseName"))
    .filter(Boolean)
    .map((name) => nodeText(source, name).trim())
    .join(" | ");
}

const OPAQUE_ATOM_TYPES = new Set(["Liftoscript", "ReuseLiftoscript"]);

function statementAtoms(source, statement) {
  const atoms = [];
  function childSegment(parent, child, count) {
    if (child.type.name === "ExerciseSection") {
      const property = child.getChild("ExerciseProperty")
        ?.getChild("ExercisePropertyName");
      if (property) return `ExerciseSection:property:${nodeText(source, property)}`;
      const kindCount = (kind) => {
        let result = 1;
        for (let sibling = child.prevSibling; sibling; sibling = sibling.prevSibling) {
          if (sibling.type.name === "ExerciseSection" && sibling.getChild(kind)) result += 1;
        }
        return result;
      };
      if (child.getChild("ReuseSectionWithWeekDay")) {
        return `ExerciseSection:reuse:${kindCount("ReuseSectionWithWeekDay")}`;
      }
      if (child.getChild("Superset")) return "ExerciseSection:superset";
      if (child.getChild("ExerciseSets")) {
        return `ExerciseSection:sets:${kindCount("ExerciseSets")}`;
      }
    }
    if (child.type.name === "FunctionArgument") {
      const key = child.getChild("KeyValue")?.getChild("Keyword");
      if (key) return `FunctionArgument:key:${nodeText(source, key)}`;
    }
    return `${child.type.name}:${count}`;
  }
  function visit(node, path) {
    if (OPAQUE_ATOM_TYPES.has(node.type.name) || !node.firstChild) {
      atoms.push({ path: path.join("/"), from: node.from, to: node.to });
      return;
    }
    const counts = new Map();
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.type.name === "SectionSeparator") continue;
      const count = (counts.get(child.type.name) ?? 0) + 1;
      counts.set(child.type.name, count);
      visit(child, [...path, childSegment(node, child, count)]);
    }
  }
  visit(statement, ["ExerciseExpression:1"]);
  atoms.sort((left, right) => left.from - right.from || left.to - right.to);
  const fragments = [];
  let offset = statement.from;
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.from > offset) {
      const previous = atoms[index - 1]?.path ?? "start";
      fragments.push({ key: `gap:${previous}->${atom.path}`, text: source.slice(offset, atom.from) });
    }
    fragments.push({ key: atom.path, text: source.slice(atom.from, atom.to) });
    offset = atom.to;
  }
  if (offset < statement.to) {
    fragments.push({ key: `gap:${atoms.at(-1)?.path ?? "start"}->end`, text: source.slice(offset, statement.to) });
  }
  return fragments;
}

function projectStructuredStatements(source, root) {
  const projected = [];
  const identities = new Map();
  let offset = 0;
  let week = "";
  let day = "";
  let statementCount = 0;
  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.type.name === "Week") week = nodeText(source, node).slice(1).trim();
    if (node.type.name === "Day") day = nodeText(source, node).slice(2).trim();
    if (node.type.name !== "ExerciseExpression") continue;
    projected.push(source.slice(offset, node.from));
    const label = exerciseVariationsIdentity(source, node.getChild("ExerciseVariations"));
    const identityBase = JSON.stringify([week, day, label]);
    const occurrence = (identities.get(identityBase) ?? 0) + 1;
    identities.set(identityBase, occurrence);
    const identity = JSON.stringify([week, day, label, occurrence]);
    projected.push(`${STATEMENT_MARKER} ${identity}\n`);
    for (const atom of statementAtoms(source, node)) {
      projected.push(`${ATOM_MARKER} ${atom.key}\n`);
      projected.push(`${ATOM_VALUE} ${Buffer.from(atom.text).toString("base64")}\n`);
      projected.push(`${ATOM_END} ${atom.key}\n`);
    }
    projected.push(`${STATEMENT_END} ${identity}\n`);
    statementCount += 1;
    offset = node.to;
  }
  projected.push(source.slice(offset));
  return { source: projected.join(""), statementCount };
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
    const fragments = [];
    index += 1;
    while (index < lines.length && lines[index] !== `${STATEMENT_END} ${identity}`) {
      const atom = lines[index];
      if (!atom.startsWith(`${ATOM_MARKER} `)) {
        throw new Error(`Projected statement atom could not be restored: ${identity}`);
      }
      index += 1;
      if (!lines[index]?.startsWith(`${ATOM_VALUE} `)) {
        throw new Error(`Projected statement atom value is missing: ${identity}`);
      }
      fragments.push(Buffer.from(lines[index].slice(ATOM_VALUE.length + 1), "base64").toString());
      index += 1;
      if (lines[index] !== `${ATOM_END} ${atom.slice(ATOM_MARKER.length + 1)}`) {
        throw new Error(`Projected statement atom end is missing: ${identity}`);
      }
      index += 1;
    }
    if (index >= lines.length) {
      throw new Error(`Projected statement end is missing: ${identity}`);
    }
    restored.push(fragments.join("").replace(/\n$/, ""));
  }
  return restored.join("\n");
}

export function parseLiftosaurMergeDocument(source) {
  const normalized = normalizeLineEndings(source);
  const root = parsePlannerSyntax(normalized);
  const manifest = [];
  const order = [];
  const blocks = new Map();
  const statementIdentities = new Map();
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
    const label = exerciseVariationsIdentity(normalized, variations);
    const identityBase = JSON.stringify([week, day, label]);
    const occurrence = (statementIdentities.get(identityBase) ?? 0) + 1;
    statementIdentities.set(identityBase, occurrence);
    addBlock(JSON.stringify(["statement", week, day, label, occurrence]), text);
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
    STATEMENT_MARKER,
    ATOM_MARKER,
    ATOM_VALUE,
    ATOM_END,
    STATEMENT_END,
    BLOCK_MARKER,
  ].some((marker) => normalized.includes(marker))) {
    throw new Error("Liftosaur source contains a reserved merge marker");
  }

  const root = parsePlannerSyntax(normalized);
  const structured = projectStructuredStatements(normalized, root);
  return {
    frontend: LIFTOSAUR_MERGE_FRONTEND,
    source: structured.source,
    stateBlockCount: 0,
    stateOrders: [],
    statementCount: structured.statementCount,
  };
}

export function restoreProjectedSource(source) {
  const normalized = normalizeLineEndings(source);
  return canonicalizeLiftosaurSource(restoreStructuredStatements(normalized));
}
