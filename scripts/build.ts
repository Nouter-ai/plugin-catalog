// Arma dist/directory.json, el índice de lo que se muestra en Discover. Uso: node scripts/build.ts vN
// (sin versión, "dev"). `added` sale del historial de git: el release corre con fetch-depth: 0.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDirectory, gitAddedAt } from "./directory.ts";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const version = process.argv[2] ?? "dev";
  if (!/^(v[1-9][0-9]*|dev)$/.test(version)) throw new Error(`versión inválida: ${version} (vN o dev)`);
  const idx = await buildDirectory(root, version, gitAddedAt(root));
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "directory.json"), `${JSON.stringify(idx, null, 2)}\n`);
  console.log(`dist/directory.json: ${version}, ${idx.entries.length} entradas`);
}
