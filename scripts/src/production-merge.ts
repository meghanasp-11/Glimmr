/**
 * Merge per-area production files into one import dataset.
 *
 * Each area file is `{ serviceArea: {...}, places: [...] }` (see
 * data/production/*.json). Files are discovered, never hard-coded, so areas
 * are data: adding a fourth area means adding a file, not a code branch.
 * The merged `{ serviceAreas, places }` dataset feeds validateSeedFile with
 * the production profile, which rejects duplicate ids and duplicate
 * name+address pairs globally — across all areas.
 */

import {
  ServiceAreaSchema,
  type ServiceArea,
} from "../../artifacts/glimmr/src/schemas/glimmr.schema";

export interface AreaFileInput {
  /** File name, used in error messages and for deterministic ordering. */
  source: string;
  /** Parsed JSON content of the file. */
  raw: unknown;
}

export interface MergedDataset {
  serviceAreas: ServiceArea[];
  places: unknown[];
}

export type MergeResult = { ok: true; data: MergedDataset } | { ok: false; errors: string[] };

export function mergeAreaFiles(inputs: AreaFileInput[]): MergeResult {
  const errors: string[] = [];
  const areas: ServiceArea[] = [];
  const places: unknown[] = [];
  const seenAreaIds = new Set<string>();

  const ordered = [...inputs].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  for (const { source, raw } of ordered) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${source}: must be a JSON object with 'serviceArea' and 'places'.`);
      continue;
    }
    const file = raw as Partial<{ serviceArea: unknown; places: unknown }>;
    const areaParsed = ServiceAreaSchema.safeParse(file.serviceArea);
    if (!areaParsed.success) {
      errors.push(`${source}: invalid 'serviceArea'.`);
      continue;
    }
    if (seenAreaIds.has(areaParsed.data.id)) {
      errors.push(`${source}: duplicate serviceArea id "${areaParsed.data.id}".`);
      continue;
    }
    seenAreaIds.add(areaParsed.data.id);
    areas.push(areaParsed.data);

    if (!Array.isArray(file.places)) {
      errors.push(`${source}: 'places' must be an array.`);
      continue;
    }
    for (const [index, candidate] of file.places.entries()) {
      if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
        const declared = (candidate as { serviceArea?: unknown }).serviceArea;
        if (declared !== undefined && declared !== areaParsed.data.id) {
          const id =
            typeof (candidate as { id?: unknown }).id === "string"
              ? (candidate as { id: string }).id
              : `#${index}`;
          errors.push(
            `${source}: place "${id}" declares serviceArea "${String(declared)}" but lives in the "${areaParsed.data.id}" file.`,
          );
          continue;
        }
      }
      places.push(candidate);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { serviceAreas: areas, places } };
}
