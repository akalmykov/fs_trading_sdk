# Review Handoff Schema

This defines the artifact chain produced by the `/implement-feature` skill and consumed by `/implement-feature-review`.

## Input Format

The user invokes the review with:

```
/implement-feature-review <handoff-doc-path>
```

Where `<handoff-doc-path>` points to the **original input document** (the spec/handoff that started the implementation). The review agent can then locate all related artifacts using the naming convention:

```
<original-input>                                    # provided by user
Docs/plans/<feature-name>-plan.md                   # implementation plan
Docs/plans/<feature-name>-validation/               # pre-implementation validation
  validator-codebase.md                             #   file/function/import accuracy
  validator-gaps.md                                 #   missing steps, dependency gaps
  validator-conventions.md                          #   convention compliance
Docs/plans/<feature-name>-complete.md               # post-implementation completion report
```

The `<feature-name>` is derived from the original input filename:
- `Docs/bucket-trading-handoff.md` -> `bucket-trading`
- `Docs/custom-shape-widget-handoff.md` -> `custom-shape-widget`

## Artifact Descriptions

### 1. Original Input (user-provided)
The spec or handoff document that describes what should be built. This is the source of truth for requirements.

### 2. Plan (`-plan.md`)
The orchestrator's implementation plan, validated and approved by the user before implementation began. Contains:
- Context and input source
- Affected layers
- Work streams with file ownership declarations
- Work stream dependencies and execution order
- Testing strategy
- Doc update requirements

### 3. Validation (`-validation/`)
Three validator reports produced BEFORE implementation. These confirm the plan was sound:
- **validator-codebase.md** -- verified file paths, functions, imports, types exist
- **validator-gaps.md** -- checked for missing steps against SDK Expansion Checklist
- **validator-conventions.md** -- checked for convention/pattern violations

### 4. Completion Report (`-complete.md`)
Post-implementation summary produced by the orchestrator after all work streams finished. Contains:
- What was built (synthesized from supervisor reports)
- Files changed (consolidated list)
- Deviations from plan
- Unresolved issues
- Test results
- Doc updates made
