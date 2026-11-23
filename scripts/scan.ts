// El chequeo de la revisión de seguridad del CI. Un pull request solo puede cambiar un item que el revisor de seguridad
// del Directory de Nouter ya vio: este paso manda cada item cuya carpeta cambió en el rango (`plugins/<nombre>/` o
// `skills/<nombre>/`) a `POST <DIRECTORY_SCAN_URL>/directory/scan` y falla el check salvo que el veredicto sea `passed`.
//
// El control es dueño de los topes (200 archivos / 5 MB), del modelo y del prompt; este repo solo manda los archivos de
// texto del item, con su ruta relativa a la carpeta, y los hosts que el item declara en su `.mcp.json` de la raíz. El
// revisor responde 200 o 202 con `{ scanId, status, verdict, findings }`; una revisión `running` se consulta por scanId.
//
// Fail-closed: solo `status: "done"` con `verdict: "passed"` pasa. `possible-risk`, `blocked`, una falla, un error
// (`scan-too-large`, `rate-limited`, `internal`, …) y un timeout son todos rojo — una falla nunca es una aprobación.
//
// El repo es público: la URL y el token de servicio de Access son secretos, nunca literales. Sin `DIRECTORY_SCAN_URL` el
// paso imprime `revisión de seguridad sin configurar: se saltea` y sale 0 (el token lo aprovisiona otra pieza). Un PR de
// un fork no recibe los secretos, así que el salteo solo vale mientras la revisión no esté configurada: la variable de
// repositorio `DIRECTORY_SCAN_ENABLED`, que los forks sí ven, en `true` convierte la falta de URL o de token en rojo, y
// el merge no deja pasar un cambio que no se revisó.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Los tipos de item que el control acepta para este repo: un plugin cuando la carpeta tiene `.claude-plugin/plugin.json`,
 *  una skill si no. Los blueprints viajan dentro de un plugin y no son items sueltos acá. */
export type ScanItemKind = "plugin" | "skill";

type ScanFile = { path: string; content: string };
type ScanManifest = { hosts: string[] };
/** El cuerpo de `POST /directory/scan`, la misma entrada por contenido que valida el control. */
export type ScanContent = { kind: ScanItemKind; files: ScanFile[]; manifest?: ScanManifest };

/** Un hallazgo como lo devuelve el revisor: puede citar un archivo y una línea, nunca el item entero. */
type Finding = { source?: string; severity?: string; file?: string; line?: number; reason?: string };
/** La revisión como la devuelve el revisor. `scanId` y `status` son los únicos campos de los que depende este paso. */
type ScanView = { scanId: string; status: string; verdict: string | null; findings: Finding[]; error: string | null };

/** El entorno del paso. Los tests lo completan directamente; la CLI lo lee de `process.env`. */
export type ScanEnv = {
  url?: string;
  clientId?: string;
  clientSecret?: string;
  /** La variable de repositorio `DIRECTORY_SCAN_ENABLED` (`"true"` la prende). Los secrets no llegan a un PR de un fork
   *  y las variables sí: con esto en `true`, que falte la URL o el token es rojo, no un salteo. */
  enabled?: string;
  /** El rango de commits del cambio. En un pull request la base es la rama destino y el head el commit de merge; en un
   *  push a main la base es el commit anterior. Sin los dos, o cuando git no puede calcular el rango, se revisan todos
   *  los items (el control reusa por hash, así que solo lo nuevo paga el modelo). */
  base?: string;
  head?: string;
  /** La raíz del repositorio. La CLI usa el directorio de trabajo; los tests pasan un fixture. */
  root?: string;
  /** Intervalo de consulta y plazo para una revisión `running`. Los defaults son el contrato: 15 s y 10 min. */
  pollMs?: number;
  timeoutMs?: number;
};

/** El resultado del paso: el código de salida y las líneas a imprimir. Nada acá llama a `process.exit`. */
export type ScanResult = { code: number; lines: string[] };

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const ITEM_ROOTS = ["plugins", "skills"] as const;
// Los formatos binarios y de imagen que nunca viajan al revisor (PD14). Un byte NUL es la otra prueba, por contenido.
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".tif", ".tiff", ".pdf",
  ".zip", ".gz", ".tgz", ".tar", ".bz2", ".xz", ".7z", ".rar", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4",
  ".mov", ".avi", ".wav", ".ogg", ".webm", ".so", ".dylib", ".dll", ".exe", ".bin", ".class", ".jar", ".pyc", ".wasm",
  ".sqlite", ".db"]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** El tipo de una carpeta de item, o `null` cuando la carpeta no es un item (borrada, o sin manifiesto). */
export function itemKind(root: string, folder: string): ScanItemKind | null {
  if (existsSync(join(root, folder, ".claude-plugin", "plugin.json"))) return "plugin";
  if (existsSync(join(root, folder, "SKILL.md"))) return "skill";
  return null;
}

/** Todos los items del repositorio: los directorios bajo `plugins/` y `skills/` que traen un manifiesto. Es el fallback
 *  cuando no se puede calcular el rango de cambios. */
export async function allItems(root: string): Promise<string[]> {
  const items: string[] = [];
  for (const base of ITEM_ROOTS) {
    let entries;
    try { entries = await readdir(join(root, base), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = `${base}/${entry.name}`;
      if (itemKind(root, folder) !== null) items.push(folder);
    }
  }
  return items.sort();
}

/** Las carpetas de item (`plugins/<nombre>` o `skills/<nombre>`) que toca el rango de cambios, o `null` cuando el rango
 *  no se puede calcular (sin base/head, un commit inválido, un primer push). Un cambio en cualquier archivo dentro de un
 *  item lo selecciona; una baja también, y después se saltea si la carpeta ya no está. */
export function changedItems(root: string, base?: string, head?: string): string[] | null {
  if (!base || !head) return null;
  let output: string;
  try {
    output = execFileSync("git", ["diff", "--name-only", "--no-renames", `${base}..${head}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  const folders = new Set<string>();
  for (const path of output.split("\n")) {
    const m = /^(plugins|skills)\/([^/]+)\//.exec(path);
    if (m) folders.add(`${m[1]}/${m[2]}`);
  }
  return [...folders].sort();
}

/** Un archivo viaja cuando es texto: no es un formato binario conocido y no tiene un byte NUL cerca del principio. */
function isText(path: string, bytes: Buffer): boolean {
  if (BINARY_EXT.has(extname(path).toLowerCase())) return false;
  const end = Math.min(bytes.length, 8_000);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return false;
  return true;
}

/** Todos los archivos de texto bajo la carpeta, con su ruta relativa y barras normales. Los symlinks se ignoran para que
 *  el recorrido no salga del item; `.git` y `node_modules` no son contenido del item. */
async function textFiles(base: string, rel: string, out: ScanFile[]): Promise<void> {
  const entries = await readdir(rel ? join(base, rel) : base, { withFileTypes: true });
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      await textFiles(base, child, out);
    } else if (entry.isFile()) {
      const bytes = await readFile(join(base, child));
      if (isText(child, bytes)) out.push({ path: child, content: bytes.toString("utf8") });
    }
  }
}

/** Los hosts que el item declara en su `.mcp.json` de la raíz (`mcpServers.<nombre>.url`), como los lee el lector del
 *  Directory. Un archivo que no parsea o una URL que no parsea no declara ningún host. */
async function declaredHosts(file: string): Promise<string[]> {
  let text: string;
  try { text = await readFile(file, "utf8"); } catch { return []; }
  let json: unknown;
  try { json = JSON.parse(text); } catch { return []; }
  if (!isObj(json) || !isObj(json.mcpServers)) return [];
  const hosts = new Set<string>();
  for (const server of Object.values(json.mcpServers)) {
    if (!isObj(server) || typeof server.url !== "string") continue;
    try { hosts.add(new URL(server.url).hostname); } catch { /* una URL que no parsea no declara host */ }
  }
  return [...hosts];
}

/** El contenido de un item, listo para `POST /directory/scan`, o `null` cuando la carpeta no es un item (borrada o sin
 *  manifiesto). */
export async function collectItem(root: string, folder: string): Promise<ScanContent | null> {
  const kind = itemKind(root, folder);
  if (kind === null) return null;
  const dir = join(root, folder);
  const files: ScanFile[] = [];
  await textFiles(dir, "", files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hosts = await declaredHosts(join(dir, ".mcp.json"));
  return { kind, files, ...(hosts.length ? { manifest: { hosts } } : {}) };
}

function parseView(json: unknown): ScanView | null {
  if (!isObj(json) || typeof json.scanId !== "string" || typeof json.status !== "string") return null;
  return {
    scanId: json.scanId,
    status: json.status,
    verdict: typeof json.verdict === "string" ? json.verdict : null,
    findings: Array.isArray(json.findings) ? json.findings.filter(isObj) as Finding[] : [],
    error: typeof json.error === "string" ? json.error : null,
  };
}

function describeFinding(finding: Finding): string {
  const where = typeof finding.file === "string" && finding.file !== ""
    ? `${finding.file}${typeof finding.line === "number" ? `:${finding.line}` : ""}`
    : "el item";
  const layers = [finding.source, finding.severity].filter((x): x is string => typeof x === "string" && x !== "");
  const reason = typeof finding.reason === "string" && finding.reason !== "" ? finding.reason : "sin detalle";
  return `${where}: ${reason}${layers.length ? ` (${layers.join(" / ")})` : ""}`;
}

type Review = { ok: true } | { ok: false; reason: string; lines: string[] };

const messageOf = (e: unknown): string => e instanceof Error ? e.message : String(e);

/** Manda un item y devuelve su revisión, consultando mientras corre. Todo resultado distinto de pasado es una falla. */
async function reviewItem(
  base: string,
  headers: Record<string, string>,
  item: ScanContent,
  poll: { pollMs: number; timeoutMs: number },
  fetchImpl: typeof fetch,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<Review> {
  const fail = (reason: string, lines: string[] = []): Review => ({ ok: false, reason, lines });

  let res: Response;
  try {
    res = await fetchImpl(`${base}/directory/scan`, { method: "POST", headers, body: JSON.stringify(item) });
  } catch (e) {
    return fail(`no se pudo alcanzar al revisor: ${messageOf(e)}`);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* un cuerpo ilegible es una falla más abajo */ }
  if (res.status !== 200 && res.status !== 202) {
    const error = isObj(body) && typeof body.error === "string" ? body.error : "sin detalle";
    return fail(`el revisor rechazó el item (${res.status} ${error})`);
  }
  let current = parseView(body);
  if (current === null) return fail(`el revisor devolvió una respuesta inesperada (${res.status})`);

  const started = now();
  while (current.status === "running") {
    if (now() - started >= poll.timeoutMs) return timeoutFailure(poll.timeoutMs);
    await sleep(poll.pollMs);
    if (now() - started >= poll.timeoutMs) return timeoutFailure(poll.timeoutMs);
    let polled: Response;
    try {
      polled = await fetchImpl(`${base}/directory/scan/${encodeURIComponent(current.scanId)}`, { headers });
    } catch (e) {
      return fail(`no se pudo alcanzar al revisor: ${messageOf(e)}`);
    }
    let next: unknown = null;
    try { next = await polled.json(); } catch { /* se maneja más abajo */ }
    if (!polled.ok) return fail(`el revisor devolvió ${polled.status} para la revisión ${current.scanId}`);
    const view = parseView(next);
    if (view === null) return fail(`el revisor devolvió una respuesta inesperada para la revisión ${current.scanId}`);
    current = view;
  }

  if (current.status === "failed") return fail(`la revisión de seguridad falló: ${current.error ?? "error desconocido"}`);
  if (current.status !== "done") return fail(`la revisión de seguridad terminó en un estado desconocido: ${current.status}`);
  if (current.verdict !== "passed") {
    return fail(`la revisión de seguridad devolvió ${current.verdict ?? "sin veredicto"}`, current.findings.map(describeFinding));
  }
  return { ok: true };
}

const timeoutFailure = (timeoutMs: number): Review => ({ ok: false, reason: `la revisión de seguridad agotó el tiempo de espera (sin veredicto después de ${timeoutMs} ms)`, lines: [] });

/**
 * El paso: del entorno a un código de salida y sus líneas. Sin `DIRECTORY_SCAN_URL` se saltea y sale 0, salvo con
 * `DIRECTORY_SCAN_ENABLED=true`; con la URL puesta, es obligatorio y cualquier falla es rojo.
 */
export async function runScan(env: ScanEnv, deps: { fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<ScanResult> {
  const lines: string[] = [];
  const enabled = env.enabled?.trim() === "true";
  const url = env.url?.trim();
  if (!url) {
    // Un PR de un fork no recibe los secretos: con la revisión prendida, el salteo sería un verde falso (y el rojo
    // llegaría recién en el push a main, después del merge). La variable de repositorio sí la ve un fork.
    if (enabled) {
      lines.push("la revisión de seguridad no corre en un PR de un fork: la corre un mantenedor (DIRECTORY_SCAN_URL no está disponible)");
      return { code: 1, lines };
    }
    lines.push("revisión de seguridad sin configurar: se saltea");
    return { code: 0, lines };
  }
  const clientId = env.clientId?.trim() ?? "";
  const clientSecret = env.clientSecret?.trim() ?? "";
  if (!clientId || !clientSecret) {
    lines.push(enabled
      ? "la revisión de seguridad no corre en un PR de un fork: la corre un mantenedor (DIRECTORY_SCAN_CLIENT_ID y DIRECTORY_SCAN_CLIENT_SECRET no están disponibles)"
      : "revisión de seguridad mal configurada: DIRECTORY_SCAN_CLIENT_ID y DIRECTORY_SCAN_CLIENT_SECRET son obligatorios cuando DIRECTORY_SCAN_URL está puesta");
    return { code: 1, lines };
  }

  const root = env.root ?? process.cwd();
  const changed = changedItems(root, env.base, env.head);
  if (changed === null) lines.push("no se pudo calcular el rango de cambios: se revisan todos los items");
  const items = changed ?? await allItems(root);
  if (items.length === 0) {
    lines.push("ningún item cambió: nada para revisar");
    return { code: 0, lines };
  }

  const base = url.replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    "cf-access-client-id": clientId,
    "cf-access-client-secret": clientSecret,
  };
  const poll = { pollMs: env.pollMs ?? DEFAULT_POLL_MS, timeoutMs: env.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let passed = true;
  for (const folder of items) {
    let review: Review;
    try {
      const item = await collectItem(root, folder);
      if (item === null) continue; // borrado o ya no es un item: nada para revisar
      review = await reviewItem(base, headers, item, poll, fetchImpl, now, sleep);
    } catch (e) {
      // Una falla leyendo el item o hablando con el revisor es rojo, nunca un pase (fail-closed).
      review = { ok: false, reason: `no se pudo revisar el item: ${messageOf(e)}`, lines: [] };
    }
    if (review.ok) {
      lines.push(`${folder}: revisión pasada`);
    } else {
      passed = false;
      lines.push(`${folder}: ${review.reason}`);
      for (const line of review.lines) lines.push(`  ${line}`);
    }
  }
  return { code: passed ? 0 : 1, lines };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runScan({
    url: process.env.DIRECTORY_SCAN_URL,
    clientId: process.env.DIRECTORY_SCAN_CLIENT_ID,
    clientSecret: process.env.DIRECTORY_SCAN_CLIENT_SECRET,
    enabled: process.env.DIRECTORY_SCAN_ENABLED,
    base: process.env.BASE_SHA,
    head: process.env.HEAD_SHA,
  });
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}
