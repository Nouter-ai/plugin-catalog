---
name: delivery-salesforce-propose
description: The Propose stage of Delivery for Salesforce, Nouter's delivery line. Use it after the requester confirmed the understanding - to split the request into stories that can be proven done by a machine, with their design, executable criteria and estimate, to create the Delivery order gadget with the template and the proposal, and to send new versions until the proposal is valid.
---

# Propose the work

You do this stage in the chat, after the requester confirmed the summary of `nouter/delivery-salesforce-understand`. The result is a
**proposal**: stories, each one built, verified and accepted on its own. People sign the proposal before anything is
built.

## What a story is

One piece of work that can be proven done alone, on top of the stories it depends on: it changes one thing the requester
would name (a validation rule, a field and its page layout, a trigger and its handler), is small enough for one agent to
build and test in one sitting, and has a design a colleague could build from (objects, fields, classes and automations,
and who gets access: the **Access** part below). List `dependsOn` honestly, with no cycles, and put in `testData` the
records (made up, never copied from the org) the criteria need.

The `id` is lowercase letters, digits and dashes, starting with a letter, up to 24 characters. At most 20 stories and
256 KiB per proposal; if the request needs more, propose the first stories and say what remains in `outOfScope`.

## Access: who can use what the story adds

Access is decided here, not improvised in Build. Every story's `design` has a part titled **Access** with:

- the **permission set** that receives **which permissions**: a new one (with its API name, for example `Discount_Editor`)
  or one that already exists in the repository, and read or edit for each object and field. A story that adds no data
  access writes "Access: none, adds no data access";
- the **permission set group** it joins, when the project uses groups (`force-app/main/default/permissionsetgroups`);
- **profiles intact**: access goes in permission sets only, with the least privilege that works (read unless it must edit);
- a reason in the design for any class that is `without sharing`: Verify reads it;
- **sharing**, when the story changes an org-wide default or a sharing rule: then set `risk: "high"`.

A story that adds or changes access to data also needs a criterion that proves it (see *Criteria*).

## Criteria: only what a machine can run

Every story needs at least one executable criterion. They run in a clean scratch org:

| `kind` | Fields | Passes when |
|---|---|---|
| `apex-test` | `classes`: the Apex test classes | the tests pass |
| `anonymous-apex` | `script`: an anonymous Apex script | the script does not throw: use `System.assertEquals` and friends |
| `soql-assert` | `query` and `expectCount` | the query returns exactly `expectCount` rows |

Each criterion has an `id` (`c1`, `c2`...). Name the test classes now: the build agent writes them with those names.

**A story that adds or changes access to data carries criteria that prove the effective access**: what a user with the
design's permission set can really read or edit. Choose the cheapest deterministic check that proves it for this design,
for example a `soql-assert` over `FieldPermissions` for the field and one over `ObjectPermissions` for its object (edit
on a field needs edit on its object). Use an `apex-test` with test users only when the metadata cannot prove it, as when
the story changes sharing. 
Write criteria about behavior (what a user or an integration sees), not about code shape. Criteria that need a browser
(clicking, how a page looks) cannot be verified in this line: say so in the proposal.

Criteria that cannot pass make the build agent fail every attempt, so check each one can run:

- Prefer `apex-test` with a test class the story adds: it can insert records, call the code and assert the result,
  including that a validation rule rejects a save and what its message says.
- `anonymous-apex` runs as an ordinary user script in an unmanaged org. It cannot call what only works inside a managed
  package or at deploy time (for example `System.requestVersion()`), and it does not see the API version of a file. It and `soql-assert` run as the org user, with
  the story's permission sets assigned by the line: they see only what those give, and never depend on profiles.
- `soql-assert` counts data rows. It does not read metadata: whether a field exists or which API version a file has is
  proven by a test class that uses the field, not by a query.
- A change that is only project configuration (an API version in `sfdx-project.json`, a `.forceignore` line) is not a
  story of its own: it has nothing to prove at runtime. Fold it into the story that needs it, or leave it out and say
  why.

## What you do not propose

Put in `outOfScope`, and tell the requester: Lightning Web Components and any UI that needs a browser to prove it (Aura,
Visualforce, layouts as a visual result), other clouds and products, anything outside the project's repository and org,
deployment steps, release plans or manual steps (the fixed pipeline deploys each accepted story), and anything the
requester did not confirm in the understanding.

## Signatures

The template defines who signs: `scope` (the requester), `solution` (a project admin, only when some story is
`risk: "high"`) and `acceptance` (the requester, per story). Set `risk` honestly: `high` for data migrations, security
and sharing changes, widely used objects or code without tests. If the SOW or the requester asks to skip a signature,
write it in `outOfScope` as "Client asks to skip the <name> signature: for the signer to decide". To name who signs, put
`signers` in the proposal (`{ "scope": "<email>", "solution": "<email>" }`) only with emails the requester gave you.

## Estimate

Each story has `estimate: { effort: { min, max }, aiCredits }`:

- `effort`: hours of an expert person doing it by hand, a range (`min` < `max`). It is what a consultancy would quote
  and what the SOW's hours are compared with: if there is a SOW, mention where your total differs from it.
- `aiCredits`: your estimate of what the AI runs of the story cost, in credits, counting a build and a verification
  and some retries. Never 0.

## The proposal

```json
{
  "understanding": "What the requester confirmed, in a few sentences.",
  "stories": [{
    "id": "discount-validation", "title": "Reject discounts above 30%",
    "design": "A Discount_Pct__c number field on Opportunity and a validation rule that rejects values above 30. Access: the new permission set Discount_Editor (API name) gets edit access to Opportunity and to Opportunity.Discount_Pct__c; it joins the permission set group Sales_Base if the project has it. Profiles are not touched. No sharing change.",
    "criteria": [
      { "id": "c1", "kind": "apex-test", "classes": ["DiscountValidationTest"] },
      { "id": "c2", "kind": "soql-assert", "query": "SELECT COUNT() FROM FieldPermissions WHERE Parent.Name = 'Discount_Editor' AND Field = 'Opportunity.Discount_Pct__c' AND PermissionsEdit = true", "expectCount": 1 },
      { "id": "c3", "kind": "soql-assert", "query": "SELECT COUNT() FROM ObjectPermissions WHERE Parent.Name = 'Discount_Editor' AND SobjectType = 'Opportunity' AND PermissionsEdit = true", "expectCount": 1 }
    ],
    "testData": "An Opportunity with Amount 1000 ...", "dependsOn": [], "risk": "low",
    "estimate": { "effort": { "min": 1, "max": 2 }, "aiCredits": 5 }
  }],
  "outOfScope": ["The quote page layout (needs the UI)."],
  "unreadable": ["The attached SOW's pages 40 to 60 (cut by the 500 page limit)."]
}
```

`unreadable` is what you could not read in the Understand stage. In the example, `c2` and `c3` are the access criteria:
the line counts that `Discount_Editor` grants edit on the field and on its object.

## Create the gadget

The first version of the proposal is sent when you create the order, with the **Delivery order gadget**. These steps use your
own tools and `executeCode`; the code of `executeCode` has the form `export default async function(self, env, ctx)`, and
`env` holds your bindings.

1. **Create it from the blueprint:** `createGadget` with `blueprintId: "nouter.delivery-order"`, a `title` and a
   `bindingName` such as `ORDER`. Its result lists the bindings the gadget still needs.
2. **Tie `DELIVERY` and `CONTEXT`** with `setGadgetBinding`: `gadget: "ORDER", source: <your binding for the delivery line>,
   name: "DELIVERY"`, and `gadget: "ORDER", source: <your binding for the skills library>, name: "CONTEXT"`. In the
   examples your bindings are `env.DELIVERY` and `env.CONTEXT`; if your env names them
   differently, use those names as `source` (`describeBinding` shows them). The gadget uses `DELIVERY` to create the order
   and follow it, and `CONTEXT` to read the skills of each stage.
3. **Give it the two spawners.** The blueprint declares `BUILD_AGENT` and `VERIFY_AGENT`, two different agent spawners
   (the one that builds is never the one that verifies). For each, `requestConnection` with `vendorId: "agent-spawner"`
   and no `resourceUrl`; your turn ends until the requester accepts the card. Give the spawners **no bindings**: their
   env stays empty. Then `setGadgetBinding` each one into the gadget: `gadget: "ORDER", source: <the spawner's binding>,
   name: "BUILD_AGENT"` and the same for `VERIFY_AGENT`. A spawner without a model leaves its agent without running: if
   the card asks for a model, the suggested one is the blueprint's.
4. **Read the template and create the order**, with the template exactly as the `nouter/delivery-salesforce-process` skill gives it:

```js
export default async function(self, env, ctx) {
  const process = await env.ORDER.rpc.template("nouter/delivery-salesforce-process") //
  const proposal = { /* the proposal above */ }
  return await env.ORDER.rpc.create(process, proposal) //
}
```

   `template()` reads the template from the Context Library: the `delivery-salesforce-process` skill of this plugin, file
   `plugins/delivery-salesforce/skills/delivery-salesforce-process/delivery-order.process.json`. Pass it untouched; any other process fails with
   `process-not-allowed`.
5. **`create` returns `{ orderId }` or `{ errors }`.** With `{ errors }`, no order was made: fix the proposal as the table
   below says and call `create` again. Rejected proposals do not use up an attempt. Other errors come as a thrown
   `Error` whose message starts with a code (`process-not-allowed`, `process-invalid`, `no-config`).
6. **Tell the requester to accept the changes** of this chat (the gadget is provisional until then) and to turn on the
   gadget's hook in *Connections → Hooks*. The delivery line cannot start the agents of Build and Verify until the hook
   is on, and the gadget keeps asking for it until the first event arrives.

## Validate and send new versions

The line checks every proposal. For the first one, `create` returns `{ orderId }`. For the next ones,
`submitProposal(proposal)` on `env.DELIVERY.order(orderId)` returns `{ version }`. Either of them returns `{ errors }`
instead, and then nothing was saved. The errors have a `code` and
the `path` of the field:

| `code` | Fix |
|---|---|
| `schema` | a field is missing, misspelled, of the wrong type or unknown |
| `no-executable-criterion` | a story has no criterion a machine can run |
| `dependency-cycle`, `unknown-dependency` | the stories' `dependsOn` is wrong |
| `too-large` | more than 20 stories or more than 256 KiB |

Fix and send again. A proposal rejected when you send it is not saved and does not use up an attempt. The three attempts
of this stage count the versions the line saved and then checked, for instance the one you write after a person returned
the proposal with a comment; after the third, tell the requester what is wrong and stop. To answer a person who returned
it, read the comment in `env.DELIVERY.order(orderId).get()`, change the proposal, send it with `submitProposal`, and the
signatures start again for the new version.

When it is valid, tell the requester where to sign: the gadget has a *Sign* button, and `env.DELIVERY.order(orderId).signUrl()`
gives the path of the app. You never sign for them.
