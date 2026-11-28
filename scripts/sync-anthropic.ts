// El job del seed del Directory (nouter-directory.md, «La siembra»): compara los dos upstream de Anthropic en los pines del
// lock, importa lo que cambió con el mismo importador del seed, deja el informe que va al PR y mueve el lock solo si los
// bytes copiados cambiaron. Nunca mergea ni publica: el PR lo revisa y lo mergea una persona.
//
// Uso: node scripts/sync-anthropic.ts --clones <dir> [--informe <archivo>]
//   <dir> guarda los dos clones (`kwp` y `skills`); el script los clona y los deja en el pin nuevo. Sale 0 si hay algo para
//   un PR o nada que hacer, 1 si frena cerrado (un item que se fue del upstream, una licencia distinta, un pin que no existe).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AnthropicLock, EXCLUDED, type Excluded, importAnthropic, KWP_REPO, leerLock, LOCK_FILE, PLUGINS, type PluginRow,
  SKILLS, type SkillRow, SKILLS_REPO } from "./import-anthropic.ts";
import { licenseOf } from "./marketplace.ts";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

export interface SyncOptions {
  clones: string;
  informe?: string;
  out?: string;
  lock?: string;
  tables?: { plugins: PluginRow[]; skills: SkillRow[] };
  excluded?: Excluded[];
  clonar?: (repo: string, destino: string, pin: string) => Promise<void>;
  head?: (dir: string) => Promise<string>;
}

const clonarGit = async (repo: string, destino: string, pin: string): Promise<void> => {
  if (!existsSync(join(destino, ".git"))) {
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `https://github.com/${repo}.git`, destino], { stdio: "inherit" });
  }
  // El pin del lock tiene que seguir existiendo en el upstream (un force-push lo borra): se trae antes de importar nada.
  execFileSync("git", ["-C", destino, "fetch", "--quiet", "--depth", "1", "origin", pin], { stdio: "inherit" });
};

const headGit = async (dir: string): Promise<string> =>
  execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const leer = (file: string) => readFile(file, "utf8").catch(() => "");

// La huella de una carpeta copiada: si cambió, los bytes que vería el tenant cambiaron.
async function huella(dir: string): Promise<string> {
  if (!existsSync(dir)) return "";
  const h = createHash("sha256");
  const walk = async (rel: string): Promise<void> => {
    for (const e of (await readdir(join(dir, rel), { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r);
      else h.update(`${r}\0`).update(await readFile(join(dir, r))).update("\0");
    }
  };
  await walk("");
  return h.digest("hex");
}

// Los servidores mcp de un plugin: nombre → URL (o "" si la completa el tenant).
async function servidores(dir: string): Promise<Record<string, string>> {
  const raw = await leer(join(dir, ".mcp.json"));
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> & Record<string, unknown> };
    const servers = (j.mcpServers ?? j) as Record<string, { url?: string }>;
    return Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, typeof v?.url === "string" ? v.url : ""]));
  } catch { return {}; }
}

const licenciaDe = async (file: string): Promise<string> =>
  existsSync(file) ? licenseOf(await readFile(file, "utf8")) ?? "sin licencia" : "sin licencia";

// Lo que apareció en el upstream y no está decidido: se informa, no entra (la curaduría es de una persona). Lo partner-built
// y lo de fuente externa no se informan: la tabla del documento ya los excluye.
async function loNuevo(fx: { kwp: string; skills: string }, tables: { plugins: PluginRow[]; skills: SkillRow[] }, excluded: Excluded[]) {
  const salida = { plugins: [] as string[], skills: [] as string[] };
  const raiz = await licenciaDe(join(fx.kwp, "LICENSE"));
  const origin = JSON.parse(await leer(join(fx.kwp, ".claude-plugin/marketplace.json")) || "{}") as { plugins?: { name?: string; source?: unknown }[] };
  const conocidos = new Set([...tables.plugins.map((p) => p.name), ...excluded.filter((x) => x.type === "plugin").map((x) => x.name)]);
  for (const p of origin.plugins ?? []) {
    if (typeof p.source !== "string" || !p.source.startsWith("./") || p.source.startsWith("./partner-built/")) continue;
    if (typeof p.name !== "string" || conocidos.has(p.name)) continue;
    salida.plugins.push(`${p.name} (${existsSync(join(fx.kwp, p.name, "LICENSE")) ? await licenciaDe(join(fx.kwp, p.name, "LICENSE")) : raiz})`);
  }
  const conocidas = new Set([...tables.skills.map((s) => s.name), ...excluded.filter((x) => x.type === "skill").map((x) => x.name)]);
  for (const e of await readdir(join(fx.skills, "skills"), { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || conocidas.has(e.name)) continue;
    salida.skills.push(`${e.name} (${await licenciaDe(join(fx.skills, "skills", e.name, "LICENSE.txt"))})`);
  }
  return salida;
}

// Antes de copiar nada: cada fila de las tablas tiene que seguir en el upstream y con su licencia.
async function preflight(fx: { kwp: string; skills: string }, tables: { plugins: PluginRow[]; skills: SkillRow[] }): Promise<string[]> {
  const problemas: string[] = [];
  for (const row of tables.plugins) {
    if (!existsSync(join(fx.kwp, row.name, ".claude-plugin/plugin.json"))) {
      problemas.push(`${KWP_REPO}: no hay un plugin ${row.name} (falta ${row.name}/.claude-plugin/plugin.json). Si se fue del upstream, lo decide una persona: sale de la tabla o vuelve a entrar.`);
    }
  }
  for (const row of tables.skills) {
    const from = join(fx.skills, "skills", row.name);
    if (!existsSync(join(from, "SKILL.md"))) {
      problemas.push(`${SKILLS_REPO}: no hay una skill ${row.name} (falta skills/${row.name}/SKILL.md). Si se fue del upstream, lo decide una persona.`);
      continue;
    }
    const lic = existsSync(join(from, "LICENSE.txt")) ? licenseOf(await readFile(join(from, "LICENSE.txt"), "utf8")) : null;
    if (lic !== row.license) {
      problemas.push(`${SKILLS_REPO}: la skill ${row.name} ya no trae ${row.license} (${lic ?? "sin LICENSE.txt"}): no se copia nada con otra licencia sin que una persona lo decida.`);
    }
  }
  return problemas;
}

export async function syncAnthropic(o: SyncOptions): Promise<number> {
  const out = o.out ?? ROOT;
  const lockFile = o.lock ?? LOCK_FILE;
  const tables = o.tables ?? { plugins: PLUGINS, skills: SKILLS };
  const excluded = o.excluded ?? EXCLUDED;
  const clonar = o.clonar ?? clonarGit;
  const head = o.head ?? headGit;
  const fx = { kwp: join(o.clones, "kwp"), skills: join(o.clones, "skills") };
  const lineas: string[] = ["# El seed del Directory de Anthropic", ""];
  const informe = async (codigo: number): Promise<number> => {
    const texto = `${lineas.join("\n")}\n`;
    if (o.informe) await writeFile(o.informe, texto);
    console.log(texto);
    return codigo;
  };

  try {
    const lock: AnthropicLock = await leerLock(lockFile);
    await clonar(KWP_REPO, fx.kwp, lock.kwp);
    await clonar(SKILLS_REPO, fx.skills, lock.skills);
    const nuevo: AnthropicLock = { kwp: await head(fx.kwp), skills: await head(fx.skills) };

    const problemas = await preflight(fx, tables);
    if (problemas.length) {
      lineas.push("El job no pudo traer el seed:", "", ...problemas.map((p) => `- ${p}`), "");
      lineas.push("No escribió nada: el lock y el árbol quedan como están.");
      return informe(1);
    }

    // La foto de antes: lo que el tenant ve hoy en el catálogo.
    const carpetas = async () => new Map<string, string>([
      ...await Promise.all(tables.plugins.map(async (r) => [`plugins/${r.name}`, await huella(join(out, "plugins", r.name))] as const)),
      ...await Promise.all(tables.skills.map(async (r) => [`skills/${r.name}`, await huella(join(out, "skills", r.name))] as const)),
    ]);
    const antes = await carpetas();
    const mcpAntes = new Map(await Promise.all(tables.plugins.map(async (r) => [r.name, await servidores(join(out, "plugins", r.name))] as const)));
    const mapaAntes = await leer(join(out, ".claude-plugin/marketplace.json"));
    const itemsAntes = await leer(join(out, ".nouter/directory.json"));

    const importados = await importAnthropic({ kwp: fx.kwp, skills: fx.skills, out, commits: nuevo, tables, excluded });

    const despues = await carpetas();
    const mapaDespues = await leer(join(out, ".claude-plugin/marketplace.json"));
    const itemsDespues = await leer(join(out, ".nouter/directory.json"));
    const sinPines = (t: string) => t.split(nuevo.kwp).join(lock.kwp).split(nuevo.skills).join(lock.skills);
    const arbolIgual = [...antes].every(([k, v]) => despues.get(k) === v);
    const soloPines = sinPines(mapaDespues) === sinPines(mapaAntes) && sinPines(itemsDespues) === sinPines(itemsAntes);

    lineas.push(`- knowledge-work-plugins: ${lock.kwp} → ${nuevo.kwp}`, `- skills: ${lock.skills} → ${nuevo.skills}`, "");

    const nuevos = await loNuevo(fx, tables, excluded);
    if (nuevos.plugins.length || nuevos.skills.length) {
      lineas.push("## Lo nuevo del upstream (no entra solo: la categoría, el tagline y si entra los decide una persona)", "");
      for (const p of nuevos.plugins) lineas.push(`- plugin ${p}`);
      for (const s of nuevos.skills) lineas.push(`- skill ${s}`);
      lineas.push("");
    }

    if (nuevo.kwp === lock.kwp && nuevo.skills === lock.skills) {
      lineas.push("## Lo que hizo el job", "", "Sin cambios: los dos upstream están en los pines del lock y no toca el árbol ni el lock.");
      return informe(0);
    }

    if (arbolIgual && soloPines) {
      // El upstream se movió pero los bytes copiados son idénticos: el lock se queda en el commit que una persona vio.
      if (mapaAntes) await writeFile(join(out, ".claude-plugin/marketplace.json"), mapaAntes);
      if (itemsAntes) await writeFile(join(out, ".nouter/directory.json"), itemsAntes);
      lineas.push("## Lo que hizo el job", "",
        `El upstream se movió, pero lo copiado es idéntico: el lock se queda en los pines de antes y el árbol no cambia.`);
      return informe(0);
    }

    // Cambió lo copiado: el informe dice qué, para que el PR se revise sin abrir cada archivo.
    const parse = (t: string) => { try { return JSON.parse(t) as { plugins?: { name?: string; version?: string }[] }; } catch { return { plugins: [] }; } };
    const cambios: string[] = [];
    for (const row of tables.plugins) {
      if (antes.get(`plugins/${row.name}`) === despues.get(`plugins/${row.name}`)) continue;
      const de = parse(mapaAntes).plugins?.find((p) => p.name === row.name)?.version;
      const a = parse(mapaDespues).plugins?.find((p) => p.name === row.name)?.version;
      cambios.push(`- plugin ${row.name}${de && a && de !== a ? `: ${de} → ${a}` : ""}`);
      const antesMcp = mcpAntes.get(row.name) ?? {};
      const despuesMcp = await servidores(join(out, "plugins", row.name));
      for (const [servidor, url] of Object.entries(despuesMcp)) {
        if (!(servidor in antesMcp)) cambios.push(`  - servidor mcp ${servidor}: ${url || "sin URL"} (nuevo)`);
        else if (antesMcp[servidor] !== url) cambios.push(`  - servidor mcp ${servidor}: ${antesMcp[servidor] || "sin URL"} → ${url || "sin URL"}`);
      }
      for (const servidor of Object.keys(antesMcp)) if (!(servidor in despuesMcp)) cambios.push(`  - servidor mcp ${servidor}: ya no está`);
    }
    for (const row of tables.skills) {
      if (antes.get(`skills/${row.name}`) !== despues.get(`skills/${row.name}`)) cambios.push(`- skill ${row.name}`);
    }
    lineas.push("## Lo que se copió", "", ...(cambios.length ? cambios : [`- El manifiesto cambió sin archivos nuevos (${importados} items): mirá el diff.`]), "");

    await writeFile(lockFile, `${JSON.stringify(nuevo, null, 2)}\n`);
    lineas.push("## Lo que hizo el job", "", "Deja los cambios para el PR y mueve el lock a los pines nuevos. El release y `directory:update` siguen a mano.");
    return informe(0);
  } catch (e) {
    lineas.push("El job no pudo traer el seed:", "", `- ${(e as Error).message}`, "");
    lineas.push("No escribió nada: el lock y el árbol quedan como están.");
    return informe(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valor = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const clones = valor("--clones");
  if (!clones) throw new Error("uso: node scripts/sync-anthropic.ts --clones <dir> [--informe <archivo>]");
  process.exitCode = await syncAnthropic({ clones: resolve(clones), informe: valor("--informe") });
}
