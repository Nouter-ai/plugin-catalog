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

const w = async (root: string, rel: string, text: string) => { await mkdir(join(root, rel, ".."), { recursive: true }); await writeFile(join(root, rel), text); };

// Los dos repos de Anthropic en miniatura, armados en un temporal: dentro del repo, un plugin.json o un SKILL.md llegarían a cada
// tenant (el CI lo rechaza). sales trae stdio y http, engineering no trae .mcp.json y local trae solo stdio; alpha trae licencia y beta no.
export async function anthropicFixtures(): Promise<{ kwp: string; skills: string }> {
  const dir = await mkdtemp(join(tmpdir(), "anthropic-"));
  const kwp = join(dir, "kwp"), skills = join(dir, "skills");
  const apache = await readFile(join(realRoot, "LICENSE"), "utf8");
  await w(kwp, "LICENSE", apache);
  await w(kwp, ".claude-plugin/marketplace.json", JSON.stringify({ name: "knowledge-work-plugins", owner: { name: "Anthropic" }, plugins: [
    { name: "sales", displayName: "Sales", source: "./sales", description: "Sell more." },
    { name: "engineering", source: "./engineering", description: "Ship code." },
    { name: "tercero", source: { source: "git-subdir", url: "https://github.com/x/y.git" }, description: "De afuera." }] }));
  const plugin = (name: string, version: string, description: string) => JSON.stringify({ name, version, description, author: { name: "Anthropic" } });
  await w(kwp, "sales/.claude-plugin/plugin.json", plugin("sales", "2.1.0", "Sell more. Close faster."));
  await w(kwp, "sales/LICENSE", apache);
  await w(kwp, "sales/.mcp.json", JSON.stringify({ mcpServers: { hubspot: { type: "http", url: "https://mcp.hubspot.com/anthropic" },
    benchling: { type: "http", url: "" }, local: { type: "stdio", command: "x" } } }));
  await w(kwp, "sales/skills/forecast/SKILL.md", "---\nname: forecast\ndescription: Forecast the quarter.\n---\n# Forecast\n");
  await w(kwp, "engineering/.claude-plugin/plugin.json", plugin("engineering", "1.2.0", "Ship code. Review it too."));
  await w(kwp, "engineering/skills/review/SKILL.md", "---\nname: review\ndescription: Review a change.\n---\n");
  await w(kwp, "local/.claude-plugin/plugin.json", plugin("local", "0.2.0", "Needs a local server."));
  await w(kwp, "local/.mcp.json", JSON.stringify({ mcpServers: { pdf: { command: "npx", args: ["-y", "x"] } } }));
  await w(skills, "skills/alpha/SKILL.md", "---\nname: alpha\ndescription: >\n  Alpha does a thing.\n  It does it well.\nlicense: Complete terms in LICENSE.txt\n---\n# Alpha\n");
  await w(skills, "skills/alpha/LICENSE.txt", apache);
  await w(skills, "skills/beta/SKILL.md", '---\nname: beta\ndescription: "Beta says \\"hi\\"."\n---\n# Beta\n');
  return { kwp, skills };
}
