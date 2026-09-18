#!/usr/bin/env node
/**
 * Merge per-area production files (data/production/*.json) into one
 * production dataset and validate it with the production profile.
 *
 * Area files are discovered, never hard-coded. Nothing is written unless
 * the merged dataset passes production validation; the merged file is
 * skipped on re-runs so output never feeds back in as input.
 *
 * Usage:
 *   npm run merge:production -w @glimmr/scripts -- [--dir <path>] [--out <path>] [--dry-run]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAreaFiles } from "./production-merge";
import { validateSeedFile } from "./place-import";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_DIR = path.join(REPO_ROOT, "data", "production");

function parseArgs(argv: string[]): { dir: string; out: string; dryRun: boolean } {
  let dir = DEFAULT_DIR;
  let out = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--dir requires a path argument.");
      dir = path.resolve(value);
      i += 1;
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out requires a path argument.");
      out = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}". Usage: merge-production [--dir <path>] [--out <path>] [--dry-run]`);
    }
  }
  if (!out) out = path.join(dir, "merged.production.json");
  return { dir, out, dryRun };
}

async function main(): Promise<void> {
  const { dir, out, dryRun } = parseArgs(process.argv.slice(2));

  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch (err) {
    throw new Error(
      `Could not read production dir "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Never treat our own output as input.
  const inputs = names.filter((name) => path.resolve(dir, name) !== out);

  const merged = mergeAreaFiles(
    await Promise.all(
      inputs.map(async (name) => {
        const filePath = path.join(dir, name);
        try {
          return { source: name, raw: JSON.parse(await readFile(filePath, "utf8")) as unknown };
        } catch (err) {
          throw new Error(
            `Could not read "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    ),
  );
  if (!merged.ok) {
    console.error(`Production merge failed; nothing was written:\n- ${merged.errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  const validated = validateSeedFile(
    { serviceAreas: merged.data.serviceAreas, places: merged.data.places },
    { production: true },
  );
  if (!validated.ok) {
    console.error(`Merged dataset failed production validation; nothing was written:\n- ${validated.errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Merged ${inputs.length} area file(s): ${validated.data.areas.length} service areas, ${validated.data.places.length} places (production-valid).`,
  );
  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await writeFile(out, `${JSON.stringify({ serviceAreas: validated.data.areas, places: validated.data.places }, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
