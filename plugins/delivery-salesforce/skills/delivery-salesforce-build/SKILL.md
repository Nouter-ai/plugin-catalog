---
name: delivery-salesforce-build
description: The Build stage of Delivery for Salesforce, Nouter's delivery line. Use it when you are the agent launched to build one story in a disposable VM - to implement the story's design, deploy and test it in the scratch org until it passes, and hand in the result without pushing or deploying to the target.
---

# Build one story

You are an agent launched to build **one story**. You see only your task, a VM (`vm`) and a callback (`result`): no other
tool, no chat. This skill is the contract of the stage and it rules where another skill of your task says something
different: the Salesforce skills carry examples for other environments (MCP tools, Code Analyzer, questions to the user,
other orgs), and none of that exists here.

## Your task

The task has the stage's prompt, this skill, and the input: `story` (its `design`, `criteria`, `testData` and `risk`),
`repo`, `branch`, and, when the story came back to Build, `report` (why verification failed) and `comment` (what a person
said when returning it). If it came back, fix **what the report or the comment says**, not a new design.

## The environment

- The repository is at `/workspace`, on a branch for this story. A scratch org is logged in with the alias `run`. There is
  no default org, so **every `sf` command carries `-o run`**; the VM has no session for the org's REST API.
- No secrets in the VM, and the network reaches only the repository's host and the scratch org.
- Access to what the story adds goes in the permission set its design names (the profiles stay as they are): generate it
  with `salesforce/platform-permission-set-generate` and assign it with `sf org assign permset -n <Name> -o run` before
  the tests or queries that need it. If the design does not say who gets access, create a permission set named after the
  story with the least privilege that works, and say so in the `summary`.
- The traps that cost earlier runs time are in `delivery-salesforce-traps`: read its *Building* section.
- Apex and its tests you write directly. For custom fields, validation rules and permission sets use their skills
  (`salesforce/platform-custom-field-generate`, `salesforce/platform-validation-rule-generate`,
  `salesforce/platform-permission-set-generate`): the metadata XML is fragile. There is no flow skill: write the
  `.flow-meta.xml` by hand and test it with Apex that makes it fire.

### Running commands

`vm.exec(argv, { cwd, stdin, timeoutMs })` runs a command and waits for it. The argv has no shell: use
`["sh", "-c", "..."]` for pipes and redirections.

- **A command has two minutes unless you say otherwise.** A deploy or a test run takes longer: pass
  `timeoutMs: 1_800_000` (30 minutes, the most there is), or start it with `vm.run(argv, opts)`, which returns a
  `{ jobId }` at once, and poll `vm.job(jobId)` (`state`: `running`, `done` or `failed`) every 15 seconds or so.
- **`exitCode: null` with `failure: "timeout"` means the command did not finish, not that it failed.** Run it again with
  `vm.run()` and wait with `vm.job()`, or with a longer `timeoutMs`. `failure: "vm"` means the VM failed: say so in
  your `summary` and stop.
- **`exec` gives you only the end of the output (`tail`: the last 200 lines).** The rest is saved in `r2Key`, which you
  cannot read. Send long output to a file and read the file:

```js
await vm.exec(["sh", "-c", "sf project deploy start -o run --json --wait 20 > /tmp/deploy.json 2>&1"], { cwd: "/workspace", timeoutMs: 1_800_000 })
const { content, truncated } = await vm.readFile("/tmp/deploy.json")
```

  `truncated: true` means `content` is only the start: filter big output in the command
  (`| jq '.result.details.componentFailures'`) before reading it.
- Read with `vm.readFile(path)`, not `cat`. Write with `vm.writeFile(path, content)` (up to 65,536 characters; for more,
  use `vm.exec` with `stdin`).

## What the line expects

- **Code:** one trigger per object that only delegates to a handler class, `with sharing` unless the design says
  otherwise, bulk-safe, no hardcoded ids. Verify reviews exactly this.
- **Tests:** the story's `apex-test` criteria name classes: create them with those names. Cover the single record, the
  bulk case with **251 records** (a trigger takes its records in batches of 200) and the negative path, with the test's
  own data. For `anonymous-apex` and `soql-assert` criteria, make sure the behavior they check will exist.
- **Deploy and tests, in the scratch org:** `sf project deploy start -o run --json --wait 20`, then
  `sf apex run test -o run --code-coverage --result-format json --wait 20`; read the failures, fix the cause and repeat.
  The line deploys the project and runs all the tests again itself, and they have to pass.
- **Stage your work** with `git -C /workspace add -A`: the line commits what is staged, as the bot, writes the story's
  design and criteria into `docs/delivery/<order>/<story>.md`, pushes the branch and opens the pull request, so you do not
  commit or push. Leave out generated folders the repository does not ignore (`.sf/`, `.sfdx/`, `node_modules/`).
- **Hand in the result**, once. Your task ends only when you call `result.deliver`: a text message delivers nothing, so do not stop to report progress in text.

```js
await result.deliver({ summary: "...", changes: ["force-app/.../X.cls"], tests: ["XTest"] })
```

  `summary` says what you built and any decision you took where the design was silent; `changes` and `tests` list the
  files and test classes. If you are blocked and cannot finish, hand in what you have with a `summary` that says what
  blocks it; do not ask.
