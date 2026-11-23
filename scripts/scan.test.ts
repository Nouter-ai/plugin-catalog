// Tests del paso de revisión de seguridad del CI (scripts/scan.ts). El revisor del Directory se falsea con un servidor
// HTTP local: responde 202 y después done/passed, un veredicto con hallazgos, o una falla. Ningún test habla con el
// control real y ninguno espera el intervalo de consulta de producción.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { allItems, changedItems, collectItem, runScan } from "./scan.ts";

const w = async (root: string, rel: string, text: string) => {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), text);
};
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: root, encoding: "utf8" });

// Una rebanada de repositorio: un plugin (manifiesto, una skill y un .mcp.json) y una skill. El plugin trae un binario
// que no debe viajar.
async function pluginTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scan-"));
  await w(root, "plugins/alpha/.claude-plugin/plugin.json", JSON.stringify({ name: "alpha" }));
  await w(root, "plugins/alpha/skills/demo/SKILL.md", "---\nname: demo\n---\n# Demo\n");
  await w(root, "plugins/alpha/.mcp.json", JSON.stringify({ mcpServers: { api: { type: "http", url: "https://api.example.com/mcp" } } }));
  await writeFile(join(root, "plugins/alpha/logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
  return root;
}

type Reply = { status: number; json: unknown };
type Seen = { method: string; path: string; headers: IncomingMessage["headers"]; body: string };

// Un reemplazo local del revisor del Directory. Anota cada pedido para que los tests comprueben el contrato (headers del
// token de servicio, forma del cuerpo, consulta por scanId).
async function startControl(handler: (req: IncomingMessage, body: string) => Reply | Promise<Reply>):
  Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
    const reply = await handler(req, body);
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.json));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const view = (extra: Record<string, unknown> = {}) => ({
  scanId: "s1", status: "done", verdict: "passed", findings: [], error: null, model: "m", promptVersion: "1", inputHash: "h",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...extra,
});

test("sin DIRECTORY_SCAN_URL el paso no corre y sale 0", async () => {
  const r = await runScan({});
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ["revisión de seguridad sin configurar: se saltea"]);
});

test("con la revisión prendida, un PR de un fork sin secretos es rojo y no un verde falso", async () => {
  // Los secrets no llegan a un PR de un fork y la variable de repositorio sí: sin ella, este caso sería un salteo.
  const sinUrl = await runScan({ enabled: "true" });
  assert.equal(sinUrl.code, 1);
  assert.match(sinUrl.lines.join("\n"), /no corre en un PR de un fork/);
  const sinToken = await runScan({ enabled: "true", url: "http://127.0.0.1:1" });
  assert.equal(sinToken.code, 1);
  assert.match(sinToken.lines.join("\n"), /no corre en un PR de un fork/);
  // Cualquier otro valor de la variable deja el comportamiento de siempre.
  const apagada = await runScan({ enabled: "false" });
  assert.equal(apagada.code, 0);
});

test("una URL sin el token de servicio es mala configuración, no un pase (fail-closed)", async () => {
  const r = await runScan({ url: "http://127.0.0.1:1", clientId: "", clientSecret: "" });
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /DIRECTORY_SCAN_CLIENT_ID/);
});

test("done/passed es verde; el pedido lleva el token de servicio, los archivos relativos y los hosts declarados", async () => {
  const root = await pluginTree();
  const control = await startControl((req) =>
    req.method === "POST"
      ? { status: 202, json: view({ status: "running", verdict: null }) }
      : { status: 200, json: view() });
  try {
    const r = await runScan({ url: `${control.url}/`, clientId: "id", clientSecret: "secret", root, pollMs: 1, timeoutMs: 1_000 });
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.match(r.lines.join("\n"), /plugins\/alpha: revisión pasada/);

    const post = control.seen.find((s) => s.method === "POST")!;
    assert.equal(post.path, "/directory/scan");
    assert.equal(post.headers["cf-access-client-id"], "id");
    assert.equal(post.headers["cf-access-client-secret"], "secret");
    const body = JSON.parse(post.body) as { kind: string; files: { path: string; content: string }[]; manifest: { hosts: string[] } };
    assert.equal(body.kind, "plugin");
    assert.deepEqual(body.files.map((f) => f.path).sort(), [".claude-plugin/plugin.json", ".mcp.json", "skills/demo/SKILL.md"]);
    assert.deepEqual(body.manifest, { hosts: ["api.example.com"] });

    const poll = control.seen.find((s) => s.method === "GET")!;
    assert.equal(poll.path, "/directory/scan/s1");
  } finally {
    await control.close();
  }
});

test("possible-risk es rojo, con el archivo, la línea y el motivo de cada hallazgo", async () => {
  const root = await pluginTree();
  const findings = [{ source: "model", severity: "possible-risk", file: "skills/demo/SKILL.md", line: 7, reason: "lee un archivo fuera del item" }];
  const control = await startControl(() => ({ status: 200, json: view({ verdict: "possible-risk", findings }) }));
  try {
    const r = await runScan({ url: control.url, clientId: "id", clientSecret: "secret", root, pollMs: 1, timeoutMs: 1_000 });
    const out = r.lines.join("\n");
    assert.equal(r.code, 1);
    assert.match(out, /possible-risk/);
    assert.match(out, /skills\/demo\/SKILL\.md:7/);
    assert.match(out, /lee un archivo fuera del item/);
  } finally {
    await control.close();
  }
});

test("blocked también es rojo", async () => {
  const root = await pluginTree();
  const findings = [{ source: "rules", severity: "blocked", file: ".mcp.json", reason: "manda datos a un host no declarado" }];
  const control = await startControl(() => ({ status: 200, json: view({ verdict: "blocked", findings }) }));
  try {
    const r = await runScan({ url: control.url, clientId: "id", clientSecret: "secret", root, pollMs: 1, timeoutMs: 1_000 });
    assert.equal(r.code, 1);
    assert.match(r.lines.join("\n"), /blocked/);
    assert.match(r.lines.join("\n"), /\.mcp\.json/);
  } finally {
    await control.close();
  }
});

test("una revisión failed es roja y nunca pasa", async () => {
  const root = await pluginTree();
  const control = await startControl(() => ({ status: 202, json: view({ status: "failed", verdict: null, error: "scan-failed" }) }));
  try {
    const r = await runScan({ url: control.url, clientId: "id", clientSecret: "secret", root, pollMs: 1, timeoutMs: 1_000 });
    assert.equal(r.code, 1);
    assert.match(r.lines.join("\n"), /scan-failed/);
    assert.equal(control.seen.filter((s) => s.method === "GET").length, 0);
  } finally {
    await control.close();
  }
});

test("un error del revisor (scan-too-large, rate-limited, internal) es rojo con su motivo", async () => {
  const root = await pluginTree();
  const control = await startControl(() => ({ status: 413, json: { error: "scan-too-large" } }));
  try {
    const r = await runScan({ url: control.url, clientId: "id", clientSecret: "secret", root, pollMs: 1, timeoutMs: 1_000 });
    assert.equal(r.code, 1);
    assert.match(r.lines.join("\n"), /scan-too-large/);
  } finally {
    await control.close();
  }
});

test("un revisor inalcanzable también es rojo, nunca un pase", async () => {
  const root = await pluginTree();
  // El puerto 1 está cerrado: el pedido se rechaza.
  const r = await runScan({ url: "http://127.0.0.1:1", clientId: "id", clientSecret: "secret", root, pollMs: 1, timeoutMs: 1_000 });
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /no se pudo alcanzar al revisor/);
});

test("una revisión que nunca termina agota el tiempo y es roja (un timeout no es una aprobación)", async () => {
  const root = await pluginTree();
  const control = await startControl(() => ({ status: 202, json: view({ status: "running", verdict: null }) }));
  try {
    const r = await runScan({ url: control.url, clientId: "id", clientSecret: "secret", root, pollMs: 1, timeoutMs: 25 });
    assert.equal(r.code, 1);
    assert.match(r.lines.join("\n"), /agotó el tiempo de espera/);
    assert.ok(control.seen.some((s) => s.method === "GET"));
  } finally {
    await control.close();
  }
});

test("los items cambiados salen de plugins/<nombre> y skills/<nombre> en el rango del diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-git-"));
  await w(root, "plugins/a/.claude-plugin/plugin.json", "{}");
  await w(root, "plugins/b/.claude-plugin/plugin.json", "{}");
  await w(root, "skills/c/SKILL.md", "# c\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD").trim();
  await w(root, "plugins/b/skills/nested/SKILL.md", "# cambiado\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "cambia b");
  const head = git(root, "rev-parse", "HEAD").trim();

  assert.deepEqual(changedItems(root, base, head), ["plugins/b"]);
  assert.deepEqual((await allItems(root)).sort(), ["plugins/a", "plugins/b", "skills/c"]);
});

test("un rango que no se puede calcular cae a todos los items (null), y un archivo fuera de plugins/ y skills/ no cambia nada", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-git-"));
  git(root, "init", "-q");
  await w(root, "README.md", "x\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const head = git(root, "rev-parse", "HEAD").trim();

  assert.equal(changedItems(root, "0000000", head), null);
  assert.equal(changedItems(root, undefined, head), null);
  assert.deepEqual(changedItems(root, head, head), []);
});

test("el CI corre la revisión con el token de servicio y el rango de cambios del evento", async () => {
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /node scripts\/scan\.ts/);
  assert.match(ci, /DIRECTORY_SCAN_ENABLED: \$\{\{ vars\.DIRECTORY_SCAN_ENABLED \}\}/);
  assert.match(ci, /DIRECTORY_SCAN_URL: \$\{\{ secrets\.DIRECTORY_SCAN_URL \}\}/);
  assert.match(ci, /DIRECTORY_SCAN_CLIENT_ID: \$\{\{ secrets\.DIRECTORY_SCAN_CLIENT_ID \}\}/);
  assert.match(ci, /DIRECTORY_SCAN_CLIENT_SECRET: \$\{\{ secrets\.DIRECTORY_SCAN_CLIENT_SECRET \}\}/);
  assert.match(ci, /github\.event\.pull_request\.base\.sha/);
  assert.match(ci, /github\.event\.before/);
  assert.match(ci, /fetch-depth: 0/);
});

test("un item se arma con su tipo, sus archivos de texto relativos y los hosts de su .mcp.json de la raíz", async () => {
  const root = await pluginTree();
  await w(root, "skills/beta/SKILL.md", "---\nname: beta\n---\n");

  const plugin = await collectItem(root, "plugins/alpha");
  assert.ok(plugin);
  assert.equal(plugin.kind, "plugin");
  assert.deepEqual(plugin.files.map((f) => f.path).sort(), [".claude-plugin/plugin.json", ".mcp.json", "skills/demo/SKILL.md"]);
  assert.deepEqual(plugin.manifest, { hosts: ["api.example.com"] });

  const skill = await collectItem(root, "skills/beta");
  assert.ok(skill);
  assert.equal(skill.kind, "skill");
  assert.deepEqual(skill.files.map((f) => f.path), ["SKILL.md"]);
  assert.equal(skill.manifest, undefined);

  assert.equal(await collectItem(root, "plugins/missing"), null);
});
