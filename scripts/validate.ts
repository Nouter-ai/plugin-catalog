// El CI: el marketplace, los items sueltos y los destacados valen. Uso: node scripts/validate.ts

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRepo } from "./directory.ts";

export { validateRepo };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const errors = await validateRepo(root);
  if (errors.length) {
    for (const e of errors) console.log(`MAL ${e}`);
    process.exit(1);
  }
  const { buildDirectory } = await import("./directory.ts");
  const idx = await buildDirectory(root, "dev", () => "1970-01-01T00:00:00Z");
  const n = (t: string) => idx.entries.filter((e) => e.type === t).length;
  console.log(`válido: ${n("plugin")} plugins, ${n("skill")} skills y ${n("blueprint")} blueprints sueltos`);
}
