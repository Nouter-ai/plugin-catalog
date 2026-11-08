---
name: delivery-salesforce-traps
description: What usually breaks when building and verifying a Salesforce story in Nouter's delivery line, and how to get past it. Build reads the Building section and Verify the Verifying one; read it when you give access, write tests that create users, or the same error comes back.
---

# Salesforce traps

These are not recipes: each entry is a fact about the platform that cost a real run time, with the symptom and what
holds. When you hit a symptom that is here, apply what it says instead of trying variants. Build reads *Building* and
Verify reads *Verifying*.

## Building

- **Edit on a field without edit on its object:** the permission set has `PermissionsEdit` on `Obj.Field__c` and read on
  `Obj`, and nobody can edit the field. The object needs `PermissionsEdit` too.
- **A profile in the diff:** source tracking breaks and Verify sends the story back. Access lives in a permission set.
- **`sourceApiVersion`:** the examples of other skills say 66.0. The version of the project is the `sourceApiVersion` of
  `sfdx-project.json`; a story does not change it unless the requester asked for exactly that.
- **`ISCHANGE`:** the validation-rule skill spells the function wrong. It is `ISCHANGED`.
- **A flow that fails to activate or conflicts with a version:** deploy it as a draft (`status` `Draft`) and test it with
  Apex.
- **Tests that create users or assign permission sets:**
  - Profiles by what they are, not by name (names follow the org's language):
    `[SELECT Id FROM Profile WHERE UserType = 'Standard' AND PermissionsCustomizeApplication = false LIMIT 1]`.
  - `MIXED_DML_OPERATION` when a setup object (`User`, `PermissionSetAssignment`, `Group`) and a regular record are
    inserted together: do the setup DML inside `System.runAs(new User(Id = UserInfo.getUserId()))` or in `@TestSetup`.
  - To check a field's access, `Schema.SObjectType.Opportunity.fields.Discount__c.isUpdateable()` inside
    `System.runAs(user)`; `Opportunity.Discount__c.getDescribe()` does not compile.

## Verifying

- **`no default org` or a 400 from a REST call:** every `sf` command carries `-o run`.
- **`Field does not exist` or `INVALID_FIELD` on a field the deploy just created** (anonymous Apex or SOQL), while the
  Apex tests pass: the `run` user has no FLS on it, and tests run in system mode. Assign the story's permission sets to
  `run` first.
