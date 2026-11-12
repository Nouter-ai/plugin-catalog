// La siembra del Directory con lo libre de Anthropic (docs/nouter/producto/conectores/nouter-directory.md): copia, no referencia,
// los plugins propios de anthropics/knowledge-work-plugins (los de `source` local) y las skills de anthropics/skills con
// LICENSE.txt Apache-2.0, cada uno con su licencia y su origen (repo y commit). Los plugins de terceros que lista ese
// marketplace no entran, ni las skills sin licencia (doc-coauthoring) ni las de partner-built.
//
// Uso (los repos de Anthropic se clonan afuera, en una carpeta de datos, y se pasan como argumentos):
//   node scripts/import-anthropic.ts <knowledge-work-plugins> <skills> [<repo destino>]
// Los clones tienen que estar en los commits fijados abajo. Correrlo de nuevo no duplica nada.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectoryCategory } from "./categories.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { licenseOf } from "./marketplace.ts";

export const KWP_REPO = "anthropics/knowledge-work-plugins";
export const SKILLS_REPO = "anthropics/skills";
export const KWP_COMMIT = "877a617b435ee2edfb002d9a3703c0a1a03aa1ba"; // 2026-11-10
export const SKILLS_COMMIT = "2c5958ecac7cee2b583967a2c4981d0f4a75c579"; // 2026-11-06

export interface PluginRow { name: string; category: DirectoryCategory; tags: DirectoryCategory[] }
export interface SkillRow extends PluginRow { license: "Apache-2.0" }

const p = (name: string, category: DirectoryCategory, ...tags: DirectoryCategory[]): PluginRow => ({ name, category, tags });
const s = (name: string, category: DirectoryCategory, ...tags: DirectoryCategory[]): SkillRow => ({ name, category, tags, license: "Apache-2.0" });

export const PLUGINS: PluginRow[] = [
  p("productivity", "tickets-tasks", "automation-workflows", "notes-memory"),
  p("enterprise-search", "reference-docs", "notes-memory", "files-documents"),
  p("cowork-plugin-management", "engineering", "automation-workflows"),
  p("sales", "sales", "contacts-leads", "marketing"),
  p("finance", "finance", "databases"),
  p("data", "databases", "engineering"),
  p("legal", "legal", "files-documents"),
  p("marketing", "marketing", "design-media", "email-messages"),
  p("customer-support", "tickets-tasks", "email-messages"),
  p("product-management", "tickets-tasks", "engineering", "reference-docs"),
  p("bio-research", "reference-docs", "databases"),
  p("engineering", "engineering", "logs-errors", "tickets-tasks"),
  p("human-resources", "tickets-tasks", "legal"),
  p("design", "design-media", "engineering"),
  p("operations", "automation-workflows", "tickets-tasks"),
  p("small-business", "automation-workflows", "finance", "sales"),
  p("pdf-viewer", "files-documents", "reference-docs"),
];

export const SKILLS: SkillRow[] = [
  s("academy-guide", "reference-docs", "notes-memory"),
  s("algorithmic-art", "design-media", "engineering"),
  s("brand-guidelines", "design-media", "marketing"),
  s("canvas-design", "design-media", "marketing"),
  s("claude-api", "reference-docs", "engineering"),
  s("discernment-nudge", "automation-workflows", "notes-memory"),
  s("docx", "files-documents", "reference-docs"),
  s("frontend-design", "design-media", "engineering"),
  s("internal-comms", "email-messages", "marketing"),
  s("mcp-builder", "engineering", "reference-docs"),
  s("pdf", "files-documents", "reference-docs"),
  s("pptx", "design-media", "files-documents"),
  s("skill-creator", "engineering", "automation-workflows"),
  s("slack-gif-creator", "design-media", "email-messages"),
  s("theme-factory", "design-media", "marketing"),
  s("web-artifacts-builder", "engineering", "design-media"),
  s("webapp-testing", "engineering", "automation-workflows"),
  s("xlsx", "files-documents", "finance"),
];

export interface ImportOptions {
  kwp: string; skills: string; out: string;
  commits?: { kwp: string; skills: string };
  tables?: { plugins: PluginRow[]; skills: SkillRow[] };
}

const readJson = async (file: string): Promise<any> => JSON.parse(await readFile(file, "utf8"));
const write = (file: string, v: unknown) => writeFile(file, `${JSON.stringify(v, null, 2)}\n`);
// Se copia la carpeta entera, sin lo que no es del plugin (el .git de un clon, módulos, restos del sistema).
// Un servidor MCP stdio corre un comando en la máquina de quien lo usa: el OS de Nouter no lo ejecuta (nunca se muestra) y el CI del
// Directory solo acepta servidores http. Se quita de .mcp.json (pdf-viewer trae uno); los http, con su URL o vacía, quedan como están.
async function dropStdioServers(to: string): Promise<void> {
  const file = join(to, ".mcp.json");
  if (!existsSync(file)) return;
  const raw = await readJson(file);
  const wrapped = raw.mcpServers !== undefined;
  const servers: Record<string, any> = wrapped ? raw.mcpServers : raw;
  const kept = Object.fromEntries(Object.entries(servers).filter(([, v]) => !(v && typeof v === "object" && ("command" in v || v.type === "stdio"))));
  if (Object.keys(kept).length === Object.keys(servers).length) return;
  if (Object.keys(kept).length === 0) rmSync(file);
  else await write(file, wrapped ? { ...raw, mcpServers: kept } : kept);
}

const copyDir = (from: string, to: string) => {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules|\.DS_Store)(\/|$)/.test(src) });
};

export async function importAnthropic(o: ImportOptions): Promise<number> {
  const commits = o.commits ?? { kwp: KWP_COMMIT, skills: SKILLS_COMMIT };
  const tables = o.tables ?? { plugins: PLUGINS, skills: SKILLS };
  const marketplaceFile = join(o.out, ".claude-plugin/marketplace.json");
  const itemsFile = join(o.out, ".nouter/directory.json");
  const origin = await readJson(join(o.kwp, ".claude-plugin/marketplace.json")).catch(() => ({ plugins: [] as any[] }));
  const rootLicense = join(o.kwp, "LICENSE");
  let count = 0;

  // Los plugins: la carpeta copiada tal cual (sin reescribir el .mcp.json), con la licencia del root si no trae la suya.
  const marketplace = await readJson(marketplaceFile);
  const imported = new Map<string, any>();
  for (const row of tables.plugins) {
    const from = join(o.kwp, row.name);
    if (!existsSync(join(from, ".claude-plugin/plugin.json"))) throw new Error(`${KWP_REPO}: no hay un plugin ${row.name} (falta ${row.name}/.claude-plugin/plugin.json)`);
    const manifest = await readJson(join(from, ".claude-plugin/plugin.json"));
    const to = join(o.out, "plugins", row.name);
    copyDir(from, to);
    await dropStdioServers(to);
    if (!(await readdir(to)).some((f) => /^LICENSE/i.test(f))) {
      if (licenseOf(await readFile(rootLicense, "utf8")) !== "Apache-2.0") throw new Error(`${KWP_REPO}: la licencia del root no es Apache-2.0`);
      cpSync(rootLicense, join(to, "LICENSE"));
    }
    const display = (origin.plugins as any[]).find((x) => x.name === row.name && typeof x.source === "string")?.displayName;
    imported.set(row.name, { name: row.name, ...(typeof display === "string" ? { displayName: display } : {}), source: `./plugins/${row.name}`,
      description: manifest.description, version: manifest.version, license: "Apache-2.0", category: row.category, tags: row.tags,
      author: { name: "Anthropic" }, "x-nouter": { verified: true, source: { repo: KWP_REPO, commit: commits.kwp } } });
    count++;
  }
  marketplace.plugins = [...(marketplace.plugins as any[]).filter((x) => !imported.has(x.name)), ...imported.values()];
  await write(marketplaceFile, marketplace);

  // Las skills sueltas: solo las que traen LICENSE.txt Apache-2.0; lo demás del Directory queda como estaba.
  const dir = await readJson(itemsFile);
  const skills: any[] = [];
  for (const row of tables.skills) {
    const from = join(o.skills, "skills", row.name);
    if (!existsSync(join(from, "SKILL.md"))) throw new Error(`${SKILLS_REPO}: no hay una skill ${row.name} (falta skills/${row.name}/SKILL.md)`);
    const license = existsSync(join(from, "LICENSE.txt")) ? licenseOf(await readFile(join(from, "LICENSE.txt"), "utf8")) : null;
    const to = join(o.out, "skills", row.name);
    if (license !== row.license) { rmSync(to, { recursive: true, force: true }); continue; }
    copyDir(from, to);
    const fm = parseFrontmatter(await readFile(join(from, "SKILL.md"), "utf8"));
    skills.push({ type: "skill", name: row.name, path: `skills/${row.name}`, description: fm.description, category: row.category, tags: row.tags,
      author: "Anthropic", license: row.license, verified: true, source: { repo: SKILLS_REPO, commit: commits.skills } });
    count++;
  }
  const names = new Set(skills.map((x) => x.name));
  dir.items = [...(dir.items as any[]).filter((x) => !(x.type === "skill" && names.has(x.name))), ...skills];
  await write(itemsFile, dir);
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kwp, skills, out] = process.argv.slice(2);
  if (!kwp || !skills) throw new Error("uso: node scripts/import-anthropic.ts <knowledge-work-plugins> <skills> [<repo destino>]");
  const head = (dir: string) => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head(kwp) !== KWP_COMMIT) throw new Error(`${kwp} tiene que estar en ${KWP_COMMIT} (git -C ${kwp} checkout ${KWP_COMMIT})`);
  if (head(skills) !== SKILLS_COMMIT) throw new Error(`${skills} tiene que estar en ${SKILLS_COMMIT} (git -C ${skills} checkout ${SKILLS_COMMIT})`);
  const root = out ? resolve(out) : resolve(fileURLToPath(import.meta.url), "../..");
  const n = await importAnthropic({ kwp: resolve(kwp), skills: resolve(skills), out: root });
  console.log(`importados: ${n} (${PLUGINS.length} plugins y ${SKILLS.length} skills esperados)`);
}
