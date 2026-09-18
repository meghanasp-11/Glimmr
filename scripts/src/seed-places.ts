#!/usr/bin/env node
/**
 * Seed Glimmr place data into Firestore.
 *
 * Reads a structured JSON file ({ serviceAreas: [...], places: [...] }),
 * validates every record against the existing Glimmr Zod schemas, and writes
 * the valid records to the `serviceAreas` and `places` collections.
 *
 * Validation is strict: if ANY record is incomplete or invalid, NOTHING is
 * written and the script exits non-zero with a per-record error report.
 * Writes use fixed document IDs, so re-running the seed is idempotent.
 *
 * Modes (see scripts/PLACES_IMPORT_FORMAT.md):
 * - Default: standard validation. Accepts the sample seed records.
 * - `--production`: strict production profile. Requires every
 *   recommendation-critical field, parseable opening hours, coordinates
 *   inside the area bounds, verified provenance with a source URL, and
 *   rejects anything marked as sample data.
 *
 * Usage:
 *   npm run seed:places -w @glimmr/scripts -- [--file <path>] [--dry-run] [--production]
 *
 * Environment (same convention as the API server; credentials are never
 * stored in the repo):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080   Local emulator, no credentials needed.
 *   FIREBASE_PROJECT_ID=glimmr-3b56a          Project for emulator or real Firestore.
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/key.json
 *                                            Service-account key OUTSIDE the repo (real Firestore).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSeedFile } from "./place-import";

const DEFAULT_SEED_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
  "places.seed.json",
);

// Firestore batch writes are capped at 500; stay well under it per commit.
const BATCH_CHUNK_SIZE = 400;

function parseArgs(argv: string[]): { file: string; dryRun: boolean; production: boolean } {
  let file = DEFAULT_SEED_FILE;
  let dryRun = false;
  let production = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--production") {
      production = true;
    } else if (arg === "--file") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--file requires a path argument.");
      }
      file = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}". Usage: seed-places [--file <path>] [--dry-run] [--production]`);
    }
  }
  return { file, dryRun, production };
}

function resolveProjectId(): string | undefined {
  return (
    process.env["FIREBASE_PROJECT_ID"] ??
    process.env["GOOGLE_CLOUD_PROJECT"] ??
    (process.env["FIRESTORE_EMULATOR_HOST"] ? "demo-glimmr" : undefined)
  );
}

function assertCredentialsUsable(): void {
  if (process.env["FIRESTORE_EMULATOR_HOST"]) return;
  const keyFile = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (keyFile) {
    if (!existsSync(keyFile)) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS points at "${keyFile}", which does not exist.`,
      );
    }
    return;
  }
  const adcFile = process.env["APPDATA"]
    ? path.join(process.env["APPDATA"], "gcloud", "application_default_credentials.json")
    : path.join(homedir(), ".config", "gcloud", "application_default_credentials.json");
  if (existsSync(adcFile)) return;
  throw new Error(
    "No Firestore credential source found. Set FIRESTORE_EMULATOR_HOST for the local " +
      "emulator, or GOOGLE_APPLICATION_CREDENTIALS to a service-account key file outside the repo.",
  );
}

async function main(): Promise<void> {
  const { file, dryRun, production } = parseArgs(process.argv.slice(2));

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (err) {
    throw new Error(
      `Could not read seed file "${file}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = validateSeedFile(raw, { production });
  if (!validated.ok) {
    console.error(`Seed file "${file}" is invalid; nothing was written:\n- ${validated.errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  const { areas, places } = validated.data;

  const mode = production ? "production" : "standard";
  console.log(`Seed file "${file}" valid (${mode} mode): ${areas.length} service areas, ${places.length} places.`);
  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID is not set (or set FIRESTORE_EMULATOR_HOST for the emulator).");
  }
  assertCredentialsUsable();

  const [{ initializeApp, getApps }, { getFirestore }] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/firestore"),
  ]);
  const app =
    getApps().length > 0 ? getApps()[0]! : initializeApp({ projectId });
  const db = getFirestore(app);

  // Fixed document IDs keep the seed idempotent: re-running overwrites the
  // same documents instead of duplicating them.
  const writes: { collection: string; id: string; data: unknown }[] = [
    ...areas.map((area) => ({ collection: "serviceAreas", id: area.id, data: area })),
    ...places.map((place) => ({ collection: "places", id: place.id, data: place })),
  ];
  for (let i = 0; i < writes.length; i += BATCH_CHUNK_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + BATCH_CHUNK_SIZE)) {
      batch.set(db.collection(write.collection).doc(write.id), write.data);
    }
    await batch.commit();
  }
  console.log(
    `Seeded ${areas.length} service areas and ${places.length} places into project "${projectId}".`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
