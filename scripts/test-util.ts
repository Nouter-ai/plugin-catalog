// Ayuda de los tests: un repo temporal mínimo (el marketplace con solo delivery-salesforce, que es lo propio de Nouter, y
// los archivos de .nouter), para romperlo de a una cosa sin copiar lo sembrado (decenas de MB).

import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const realRoot = new URL("..", import.meta.url).pathname;

export async function baseRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalog-"));
  const m = JSON.parse(await readFile(join(realRoot, ".claude-plugin/marketplace.json"), "utf8"));
  m.plugins = m.plugins.filter((p: { name: string }) => p.name === "delivery-salesforce");
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await writeFile(join(root, ".claude-plugin/marketplace.json"), JSON.stringify(m, null, 2));
  await cp(join(realRoot, "plugins/delivery-salesforce"), join(root, "plugins/delivery-salesforce"), { recursive: true });
  await mkdir(join(root, ".nouter"), { recursive: true });
  await writeFile(join(root, ".nouter/directory.json"), JSON.stringify({ items: [] }));
  await writeFile(join(root, ".nouter/featured.json"), JSON.stringify({ plugins: "plugin:delivery-salesforce" }));
  return root;
}
