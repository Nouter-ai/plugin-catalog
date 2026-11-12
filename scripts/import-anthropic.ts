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

export interface PluginRow { name: string; category: DirectoryCategory; tags: DirectoryCategory[]; tagline?: string }
export interface SkillRow extends PluginRow { license: "Apache-2.0" }

const p = (name: string, tagline: string, category: DirectoryCategory, ...tags: DirectoryCategory[]): PluginRow => ({ name, category, tags, tagline });
const s = (name: string, tagline: string, category: DirectoryCategory, ...tags: DirectoryCategory[]): SkillRow => ({ name, category, tags, tagline, license: "Apache-2.0" });

export const PLUGINS: PluginRow[] = [
  p("productivity", "Plan your day, track tasks and keep context about your work", "tickets-tasks", "automation-workflows", "notes-memory"),
  p("enterprise-search", "Search your company's email, chat, docs and wikis in one place", "reference-docs", "notes-memory", "files-documents"),
  p("sales", "Prep calls, research accounts and keep your pipeline moving", "sales", "contacts-leads", "marketing"),
  p("finance", "Journal entries, reconciliation, close and financial statements", "finance", "databases"),
  p("data", "Write SQL, explore datasets and turn data into dashboards", "databases", "engineering"),
  p("legal", "Contract review, NDA triage and compliance for in-house teams", "legal", "files-documents"),
  p("marketing", "Create content, plan campaigns and track performance", "marketing", "design-media", "email-messages"),
  p("customer-support", "Triage tickets, draft replies and build your knowledge base", "tickets-tasks", "email-messages"),
  p("product-management", "Write specs, plan roadmaps and synthesize user research", "tickets-tasks", "engineering", "reference-docs"),
  p("bio-research", "Search literature and databases for early-stage life sciences R&D", "reference-docs", "databases"),
  p("engineering", "Standups, code review, architecture decisions and incident response", "engineering", "logs-errors", "tickets-tasks"),
  p("human-resources", "Recruiting, onboarding, performance reviews and policy guidance", "tickets-tasks", "legal"),
  p("design", "Design critique, accessibility audits, UX writing and dev handoff", "design-media", "engineering"),
  p("operations", "Vendor management, process docs and capacity planning", "automation-workflows", "tickets-tasks"),
  p("small-business", "Ready-made workflows to run and grow a small business", "automation-workflows", "finance", "sales"),
];

export const STDIO_REASON = "depende de un servidor local (stdio), que Nouter no corre";
export interface Excluded { type: "plugin" | "skill"; name: string; reason: string }
// Lo que se mira y no entra, con el motivo. El importador también borra lo que ya hubiera de esto en el destino.
export const EXCLUDED: Excluded[] = [
  { type: "plugin", name: "pdf-viewer", reason: `${STDIO_REASON}: su skill dice «You have access to a local PDF server»` },
  { type: "plugin", name: "cowork-plugin-management", reason: "pide el entorno de la app Cowork, que Nouter no tiene" },
  { type: "skill", name: "academy-guide", reason: "le dice al modelo que recomiende Claude Academy, y en Nouter el modelo puede no ser Claude" },
];

export const SKILLS: SkillRow[] = [
  s("algorithmic-art", "Generative art with p5.js, seeded randomness and live parameters", "design-media", "engineering"),
  s("brand-guidelines", "Apply Anthropic's brand colors and typography to your documents", "design-media", "marketing"),
  s("canvas-design", "Create posters and visual art as PNG and PDF", "design-media", "marketing"),
  s("claude-api", "Reference for building with the Claude API and SDKs", "reference-docs", "engineering"),
  s("discernment-nudge", "Adds follow-up questions that help you check an answer before acting on it", "automation-workflows", "notes-memory"),
  s("docx", "Create, read and edit Word documents", "files-documents", "reference-docs"),
  s("frontend-design", "Distinctive visual design for new or existing interfaces", "design-media", "engineering"),
  s("internal-comms", "Write internal updates, newsletters and FAQs in your company's formats", "email-messages", "marketing"),
  s("mcp-builder", "Build MCP servers that let models use external services", "engineering", "reference-docs"),
  s("pdf", "Read, merge, split, fill and create PDF files", "files-documents", "reference-docs"),
  s("pptx", "Create and edit PowerPoint presentations", "design-media", "files-documents"),
  s("skill-creator", "Create, improve and measure your own skills", "engineering", "automation-workflows"),
  s("slack-gif-creator", "Make animated GIFs sized for Slack", "design-media", "email-messages"),
  s("theme-factory", "Style slides, docs and pages with ready-made themes", "design-media", "marketing"),
  s("web-artifacts-builder", "Build multi-component HTML artifacts with React and Tailwind", "engineering", "design-media"),
  s("webapp-testing", "Test local web apps with Playwright and capture screenshots", "engineering", "automation-workflows"),
  s("xlsx", "Open, edit and create spreadsheets", "files-documents", "finance"),
];

export interface ImportOptions {
  kwp: string; skills: string; out: string;
  commits?: { kwp: string; skills: string };
  tables?: { plugins: PluginRow[]; skills: SkillRow[] };
  excluded?: Excluded[];
}

const readJson = async (file: string): Promise<any> => JSON.parse(await readFile(file, "utf8"));
const write = (file: string, v: unknown) => writeFile(file, `${JSON.stringify(v, null, 2)}\n`);
// Se copia la carpeta entera, sin lo que no es del plugin (el .git de un clon, módulos, restos del sistema).
// Un servidor MCP stdio corre un comando en la máquina de quien lo usa: el OS de Nouter no lo ejecuta (nunca se muestra) y el CI del
// Directory solo acepta servidores http. Se quita de .mcp.json (pdf-viewer trae uno); los http, con su URL o vacía, quedan como están.
// Un plugin cuyo .mcp.json trae solo servidores stdio no sirve sin ellos: no se importa.
async function onlyStdio(from: string): Promise<boolean> {
  const file = join(from, ".mcp.json");
  if (!existsSync(file)) return false;
  const raw = await readJson(file);
  const servers = Object.values((raw.mcpServers ?? raw) as Record<string, any>);
  return servers.length > 0 && servers.every((v) => v && typeof v === "object" && ("command" in v || v.type === "stdio"));
}

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
  const excluded = o.excluded ?? EXCLUDED;
  const dropped = (t: Excluded["type"]) => new Set(excluded.filter((x) => x.type === t).map((x) => x.name));
  for (const name of dropped("plugin")) rmSync(join(o.out, "plugins", name), { recursive: true, force: true });
  for (const name of dropped("skill")) rmSync(join(o.out, "skills", name), { recursive: true, force: true });
  const imported = new Map<string, any>();
  for (const row of tables.plugins) {
    const from = join(o.kwp, row.name);
    if (!existsSync(join(from, ".claude-plugin/plugin.json"))) throw new Error(`${KWP_REPO}: no hay un plugin ${row.name} (falta ${row.name}/.claude-plugin/plugin.json)`);
    if (await onlyStdio(from)) {
      console.log(`excluido ${row.name}: ${STDIO_REASON}`);
      rmSync(join(o.out, "plugins", row.name), { recursive: true, force: true });
      continue;
    }
    const manifest = await readJson(join(from, ".claude-plugin/plugin.json"));
    const to = join(o.out, "plugins", row.name);
    copyDir(from, to);
    await dropStdioServers(to);
    if (!(await readdir(to)).some((f) => /^LICENSE/i.test(f))) {
      if (licenseOf(await readFile(rootLicense, "utf8")) !== "Apache-2.0") throw new Error(`${KWP_REPO}: la licencia del root no es Apache-2.0`);
      cpSync(rootLicense, join(to, "LICENSE"));
    }
    const display = (origin.plugins as any[]).find((x) => x.name === row.name && typeof x.source === "string")?.displayName;
    const tagline = row.tagline ?? (marketplace.plugins as any[]).find((x) => x.name === row.name)?.["x-nouter"]?.tagline;
    imported.set(row.name, { name: row.name, ...(typeof display === "string" ? { displayName: display } : {}), source: `./plugins/${row.name}`,
      description: manifest.description, version: manifest.version, license: "Apache-2.0", category: row.category, tags: row.tags,
      author: { name: "Anthropic" }, "x-nouter": { verified: true, ...(tagline ? { tagline } : {}), source: { repo: KWP_REPO, commit: commits.kwp } } });
    count++;
  }
  marketplace.plugins = [...(marketplace.plugins as any[]).filter((x) => !imported.has(x.name) && !dropped("plugin").has(x.name)), ...imported.values()];
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
    const tagline = row.tagline ?? (dir.items as any[]).find((x) => x.type === "skill" && x.name === row.name)?.tagline;
    skills.push({ type: "skill", name: row.name, path: `skills/${row.name}`, ...(tagline ? { tagline } : {}), description: fm.description, category: row.category, tags: row.tags,
      author: "Anthropic", license: row.license, verified: true, source: { repo: SKILLS_REPO, commit: commits.skills } });
    count++;
  }
  const names = new Set(skills.map((x) => x.name));
  dir.items = [...(dir.items as any[]).filter((x) => !(x.type === "skill" && (names.has(x.name) || dropped("skill").has(x.name)))), ...skills];
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
  console.log(`importados: ${n} (${PLUGINS.length} plugins como máximo y ${SKILLS.length} skills esperados)`);
}
