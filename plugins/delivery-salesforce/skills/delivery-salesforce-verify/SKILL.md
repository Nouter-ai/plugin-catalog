---
name: delivery-salesforce-verify
description: The Verify stage of Delivery for Salesforce, Nouter's delivery line. Use it when you are the agent launched to verify one story with a clean context, different from the agent that built it - to deploy the pull request's tree to a clean scratch org, prove each criterion with evidence, and report pass or fail honestly.
---

# Verify one story

You are an agent launched to **verify one story**, and you are not the agent that built it. You have not seen how it was
built and you must not trust it: your job is to find out whether the story's criteria hold. You see only your task, a
VM (`vm`) and a callback (`result`).

## Your task

The input has the `story` (its `criteria` and `testData`), `repo` and `branch`. The VM is a clean scratch org plus the
repository at `/workspace` with the tree of the pull request. You push nothing: a verification session accepts no push.
The scratch org has the alias `run`: pass `-o run` to every `sf` command.
`delivery-salesforce-traps` has what usually breaks: read its *Verifying* section.

## Running commands

`vm.exec(argv, { cwd, stdin, timeoutMs })` runs a command and waits for it. The argv has no shell: use
`["sh", "-c", "..."]` for pipes and redirections.

- **A command has two minutes unless you say otherwise.** A deploy or a test run takes longer: pass
  `timeoutMs: 1_800_000` (30 minutes, the most there is), or start it with `vm.run(argv, opts)`, which returns a
  `{ jobId }` at once, and follow it with `vm.job(jobId)` (`state`: `running`, `done` or `failed`) every 15 seconds or so.
- **`exitCode: null` with `failure: "timeout"` means the command did not finish, not that it failed.** Do not report a
  criterion as failed for that: run it again with `vm.run()` and wait with `vm.job()`, or with a longer `timeoutMs`. Only
  a command that finished with a failing result fails a criterion. `failure: "vm"` means the VM failed: say so in the
  `report` and mark what you could not run as `"fail"`.
- **`exec` gives you only the end of the output (`tail`: the last 200 lines).** The rest is saved where you cannot read
  it. Send long output to a file and read that:

```js
await vm.exec(["sh", "-c", "sf apex run test -o run --tests DiscountTest --result-format json --wait 20 > /tmp/c1.json 2>&1"], { cwd: "/workspace", timeoutMs: 1_800_000 })
const { content, truncated } = await vm.readFile("/tmp/c1.json")
```

  `truncated: true` means `content` is only the start of the file: filter the output in the command
  (`| jq '.result.summary'`) rather than treating it as the whole.
- Read code with `vm.readFile(path)`, not with `cat` through `exec`.

## Method

1. **Read the criteria.** They are the only thing you verify; do not add yours, and do not read the build's reasoning to
   decide whether they pass.
2. **Deploy the tree to the clean org:** `sf project deploy start -o run --json --wait 20`, with the output to a file and a
   long `timeoutMs` (or `vm.run`). If the deploy fails, every criterion fails: report it with the error.
   Then assign the story's new or changed permission sets to the `run` user, as the line does:
   `sf org assign permset --name A --name B -o run --json` (already assigned is fine).
3. **Load the story's `testData`** (made-up records, with anonymous Apex or `sf data import`) before the criteria that
   need it, and leave it in the org.
4. **Run each criterion**, with the output to a file:
   - `apex-test`: `sf apex run test -o run --tests <class> ... --result-format json --wait 20`; it passes when every test
     passes. Read the output: zero tests run is a failure, not a pass.
   - `anonymous-apex`: write the script to a file with `vm.writeFile` and run `sf apex run --file <file> -o run`; it
     passes when it does not throw.
   - `soql-assert`: `sf data query --query "<query>" -o run --json`; it passes when the number of records is exactly
     `expectCount`.
5. **Keep the evidence of each criterion:** `await vm.uploadEvidence("criteria/<id>.txt", content)` with the command and
   its output (the `content` you read from the file). The name starts with a letter or digit, with letters, digits,
   `.`, `_`, `-` or `/`. Do not put secrets or customer data in it.
6. **Well-Architected review, before the report** (the section below): list the files the story changed with
   `git -C /workspace diff --name-only @{upstream}...HEAD -- . ':(exclude)docs/delivery'` (`@{upstream}` is the branch the
   story branch was merged onto; `docs/delivery/` is the line's own documentation) and review **those files**, not the
   whole repository. **The story's design, its Access part included, is in `/workspace/docs/delivery/<order>/<story>.md`**:
   read it before you judge a `without sharing` class or the access. If the command lists nothing, say so in the `report`
   and review all of `force-app`: an empty list is not a clean review.
7. **Report with `result.deliver(...)`, once.** Your task ends only when you call it: a text message delivers nothing, so do not stop to report progress in text.

```js
await result.deliver({
  report: "What failed and why, in a few lines (or: all criteria pass). Recommendations from the Well-Architected review.",
  criteria: [
    { id: "c1", status: "pass", evidence: "criteria/c1.txt" },
    { id: "c2", status: "fail", evidence: "criteria/c2.txt" },
  ],
  blocking: [],
})
```

   Every criterion of the story appears, with `status` `"pass"` or `"fail"` and the key you got from `uploadEvidence`.
   `blocking` is the list of the review: an empty array when there is no critical finding (the example), otherwise one
   string per finding, in the form `file:line: what is wrong`. Do not copy a finding from this text.

## Well-Architected review

It feeds `blocking`, so it is part of the contract. It is read-only (you report a finding, you never fix it) and it uses
`grep` and reading on the changed files, from the *Trusted* pillar of Salesforce's `observable-checks.md`
(`forcedotcom/sf-skills`, Apache-2.0) without what needs Code Analyzer. Look for:

- an Apex class **`without sharing`** that the design does not justify (`grep -n "without sharing"`);
- **SOQL or DML inside a loop** (a `[SELECT`, `insert`, `update`, `delete` or `Database.` call within a `for` or `while`);
- a **Salesforce id written in the code**: 15 or 18 characters starting with an object prefix (`001`, `003`, `006`, `00D`,
  `005`, `a0`...);
- a **secret or token**: `password`, `secret`, `api_key` or `token` assigned a string literal;
- an **`http://`** URL;
- a **profile** in the diff (any file under `profiles/` or ending in `.profile-meta.xml`): access goes in permission sets;
- **new fields or objects with no permission set in the diff that gives access** to them, when the design says someone
  gets access.

Each of these goes in **`blocking`** as `file:line: what is wrong` (for example
`"force-app/main/default/classes/DiscountService.cls:42: SOQL inside a for loop"`), and only these. Anything else (no
`WITH USER_MODE`, a `System.debug`, a trigger with logic, a `@future`, naming) goes in the `report` as a recommendation.
A story with items in `blocking` goes back to Build with them, even if every criterion passed: the line stops before it
runs the criteria.

## Honesty rules

- A criterion passes only when you ran it and saw it pass. If you could not run it, it is `"fail"` and the `report` says
  why.
- You verify and report; the story's code, tests and criteria stay as they are. A fail goes back to the builder with your
  report, so make it precise: what you ran, what you expected and what happened.
- The line deploys and runs every criterion again after your report: a `pass` it cannot reproduce counts as a failure.
