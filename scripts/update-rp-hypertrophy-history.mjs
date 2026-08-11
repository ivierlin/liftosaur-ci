#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);
const runtimeRequire = createRequire(path.join(runtime, "package.json"));
const { decode } = runtimeRequire("he");
const outputDirectory = path.join(
  repositoryRoot,
  "test",
  "fixtures",
  "rp-hypertrophy-history"
);

const versions = [
  {
    version: "v2",
    id: "a82e42ae",
    name: "RP Hypertrophy 4-Day Upper-Lower",
    releasePost: "https://www.reddit.com/r/liftosaur/comments/1gb8kom/",
  },
  {
    version: "v3",
    id: "d97fc46",
    name: "RP Hypertrophy v3: 4-Day Upper/Lower",
    releasePost: "https://www.reddit.com/r/liftosaur/comments/1gt5ncf/",
  },
  {
    version: "v4",
    id: "8e83d63d",
    name: "RP Hypertrophy v4 Template: 4-Day Upper/Lower",
    releasePost: "https://www.reddit.com/r/liftosaur/comments/1kiurgi/",
  },
  {
    version: "v4.1",
    id: "a0ef76b",
    name: "RP Hypertrophy v4.1: 4-Day Upper/Lower",
    releasePost: "https://www.reddit.com/r/liftosaur/comments/1s6cs9p/",
  },
];

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

await mkdir(outputDirectory, { recursive: true });
const provenance = [];
for (const fixture of versions) {
  const publicUrl = `https://www.liftosaur.com/p/${fixture.id}`;
  const response = await fetch(publicUrl, {
    headers: { "user-agent": "liftosaur-ci-history-capture/1" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Could not fetch ${publicUrl}: HTTP ${response.status}`);
  const html = await response.text();
  const data = /<div id="data" style="display:none">([\s\S]*?)<\/div>/.exec(html)?.[1];
  if (!data) throw new Error(`${publicUrl} did not contain an exported program payload`);
  const program = JSON.parse(decode(data)).exportedProgram?.program;
  if (program?.name !== fixture.name) {
    throw new Error(`${publicUrl} name changed: ${program?.name}`);
  }
  const source = generateFullText(program.planner?.weeks ?? []);
  if (!source) throw new Error(`${publicUrl} has no planner source`);
  const filename = `${fixture.version}.liftoscript`;
  await writeFile(path.join(outputDirectory, filename), source, "utf8");
  provenance.push({
    version: fixture.version,
    name: fixture.name,
    publicUrl,
    releasePost: fixture.releasePost,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    fixture: filename,
  });
}

await writeFile(
  path.join(outputDirectory, "provenance.json"),
  `${JSON.stringify({ programs: provenance }, null, 2)}\n`,
  "utf8"
);
console.log(`Captured ${provenance.length} RP Hypertrophy versions.`);
