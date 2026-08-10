import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseLiftosaurMergeDocument } from "../src/frontend.mjs";
import { mergeLiftosaurSources } from "../src/merge.mjs";
import { validateLiftosaurSource } from "../src/validate.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(testDirectory);
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);
const runtimeRequire = createRequire(path.join(runtime, "package.json"));
const { decode } = runtimeRequire("he");

const fixture = Object.freeze({
  name: "RP Hypertrophy v4.1: 2-Day Full Body",
  publicUrl: "https://www.liftosaur.com/p/7ad9b47b",
  discussionUrl: "https://www.reddit.com/r/liftosaur/comments/1s6cs9p/rp_hypertrophy_program_v41_release/",
  sourceSha256: "0fa065b6f9ecbcc665e15e29f908c5fb1ab9e188409925cd640f4f8bf89429cc",
});

function generateFullText(weeks) {
  let source = "";
  for (const week of weeks) {
    if (week.description != null) {
      source += `${week.description.split("\n").map((line) => line ? `// ${line}` : "//").join("\n")}\n`;
    }
    source += `# ${week.name}\n`;
    for (const day of week.days) {
      if (day.description != null) {
        source += `${day.description.split("\n").map((line) => `// ${line}`).join("\n")}\n`;
      }
      source += `## ${day.name}\n${day.exerciseText}\n\n`;
    }
    source += "\n";
  }
  return source;
}

async function fetchPublicProgram() {
  const response = await fetch(fixture.publicUrl, {
    headers: { "user-agent": "liftosaur-ci-merge-corpus/1" },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.ok, true, `Could not fetch ${fixture.publicUrl}: HTTP ${response.status}`);
  const html = await response.text();
  const data = /<div id="data" style="display:none">([\s\S]*?)<\/div>/.exec(html)?.[1];
  assert.ok(data, "Public Liftosaur page did not contain its exported program payload");
  const exported = JSON.parse(decode(data)).exportedProgram?.program;
  assert.equal(exported?.name, fixture.name);
  assert.ok(exported.planner?.weeks?.length > 0);
  return generateFullText(exported.planner.weeks);
}

function replaceInStatement(source, label, search, replacement) {
  const statementStart = source.indexOf(`${label}:`);
  assert.notEqual(statementStart, -1, `External fixture is missing statement: ${label}`);
  const statementEnd = source.indexOf("\n\n", statementStart);
  assert.notEqual(statementEnd, -1, `External fixture statement has no boundary: ${label}`);
  const valueStart = source.indexOf(search, statementStart);
  assert.ok(valueStart >= statementStart && valueStart < statementEnd, `${label} is missing: ${search}`);
  assert.ok(source.indexOf(search, valueStart + search.length) >= statementEnd, `${label} is ambiguous: ${search}`);
  return `${source.slice(0, valueStart)}${replacement}${source.slice(valueStart + search.length)}`;
}

const source = await fetchPublicProgram();
const sourceSha256 = createHash("sha256").update(source).digest("hex");

test("external corpus source matches the reviewed RP Hypertrophy v4.1 fixture", () => {
  assert.equal(sourceSha256, fixture.sourceSha256, `Reviewed source SHA-256 is ${sourceSha256}`);
});

test("external corpus processes RP Hypertrophy v4.1 unchanged", async () => {
  const document = parseLiftosaurMergeDocument(source);
  assert.ok(document.blocks.size > 0);
  const validation = validateLiftosaurSource(source);
  assert.ok(validation.summary.days > 0);
  const result = await mergeLiftosaurSources({ base: source, active: source, candidate: source });
  assert.equal(result.report.status, "merged");
});

test("external corpus merges compatible RP Hypertrophy v4.1 progression", async () => {
  const active = replaceInStatement(source, "day01Quads00", "mesoWeek: 1, targetRpe: 7", "mesoWeek: 2, targetRpe: 7");
  const candidate = replaceInStatement(source, "day01Quads00", "mesoWeek: 1, targetRpe: 7", "mesoWeek: 1, targetRpe: 7, ciProbe: 0");
  const result = await mergeLiftosaurSources({ base: source, active, candidate });

  assert.equal(result.report.status, "merged");
  assert.match(result.source, /mesoWeek: 2, targetRpe: 7, ciProbe: 0/);
});

test("external corpus rejects conflicting RP Hypertrophy v4.1 progression", async () => {
  const active = replaceInStatement(source, "day01Quads00", "mesoWeek: 1, targetRpe: 7", "mesoWeek: 2, targetRpe: 7");
  const candidate = replaceInStatement(source, "day01Quads00", "mesoWeek: 1, targetRpe: 7", "mesoWeek: 3, targetRpe: 7");
  const result = await mergeLiftosaurSources({ base: source, active, candidate });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
});
