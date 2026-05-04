name: implement-feature-review
description: Multi-agent adversarial review of recent implementation work. Dispatches 8 parallel review agents + 1 consolidation agent. Consumes the full artifact chain from /implement-feature. Produces a detailed improvements document that can be handed to another agent for execution.
user_invocable: true
argument-hint: <handoff-doc-path>

---

# Implementation Review

You are the orchestrator for a multi-agent adversarial code review. Your job is to read the context, locate all implementation artifacts, identify what changed, dispatch focused review agents in parallel, then consolidate their findings into a single actionable report.

**NEVER SKIP ANY STEP.** Every step (1 through 6) must be executed in order. Do not skip reading prerequisites, do not skip locating artifacts, do not skip dispatching all 8 agents, do not skip consolidation, do not skip evidence verification. Each step exists because skipping it produced incomplete or incorrect reviews.

## STEP 1 -- Read Prerequisites

Read these files completely before doing anything else:

1. `internal_sdk_docs/AGENTS.md` -- Architecture rules, constraints, testing requirements
2. `internal_sdk_docs/PLAYBOOK.md` -- Checklists, patterns, existing widget/hook/function reference
3. The handoff document at `$ARGUMENTS` -- This is the original spec. Read it fully. This tells you what was SUPPOSED to be built.

If `$ARGUMENTS` is empty or the file doesn't exist, ask the user to provide the path to the handoff/plan document that was used for implementation.

## STEP 2 -- Locate Artifact Chain

The `/implement-feature` skill produces a chain of artifacts alongside the code changes. Locating these gives every review agent richer context about what was planned, what was validated, and what the implementer claims was done.

### 2a: Derive Feature Name

Derive the **feature name** from the handoff document filename:

- `Docs/bucket-trading-handoff.md` -> `bucket-trading`
- `Docs/custom-shape-widget-handoff.md` -> `custom-shape-widget`
- `Docs/plans/bucket-trading-plan.md` -> `bucket-trading`

Strip suffixes like `-handoff`, `-plan`, `-spec` from the stem.

### 2b: Locate Implementation Artifacts

Using the feature name, locate these artifacts from the implementation pipeline:

| Artifact                                     | Path                                    | Required?                       |
| -------------------------------------------- | --------------------------------------- | ------------------------------- |
| Original input (spec/handoff)                | `$ARGUMENTS`                            | YES                             |
| Requirements doc (from /plan-implementation) | `Docs/{FEATURE_NAME}-requirements.md`   | Preferred if exists             |
| Handoff doc (legacy format)                  | `Docs/{FEATURE_NAME}-handoff.md`        | Fallback if no requirements doc |
| Implementation plan                          | `Docs/plans/{FEATURE_NAME}-plan.md`     | Expected                        |
| Pre-impl validation                          | `Docs/plans/{FEATURE_NAME}-validation/` | Expected                        |
| Completion report                            | `Docs/plans/{FEATURE_NAME}-complete.md` | Expected                        |

**Requirements doc priority:** If `Docs/{FEATURE_NAME}-requirements.md` exists, use it as the primary requirements reference -- it is produced by `/plan-implementation` and is more structured than a raw handoff doc (includes SDK-readiness assessment, visual specification, improvement opportunities). Pass this path to Agent 1 (plan compliance) as the primary reference.

For each artifact, check if it exists using Glob. If an expected artifact is missing, note it but proceed -- the review can still run with just the handoff doc and the code changes, but agents that could use the missing artifact will have reduced context.

Read any artifacts that exist. These provide critical context:

- The **plan** tells you what was intended (work streams, file ownership, testing strategy, doc updates required)
- The **validation reports** tell you what issues were caught pre-implementation (codebase accuracy, gaps, convention violations)
- The **completion report** tells you what the implementing agent claims was done, including deviations from plan and unresolved issues

### 2c: Identify Code Changes

Run these commands to understand what changed:

```bash
git status --short
git log --oneline -20
git diff --name-only
git diff --stat
```

Build a list of ALL changed files (staged, unstaged, and untracked). This list gets injected into every agent's prompt.

### 2d: Create Output Directory

```bash
mkdir -p Docs/reviews/{FEATURE_NAME}/
```

## STEP 3 -- Read Agent Prompts

Read the 6 parallel review agent templates from `.Codex/skills/implement-feature-review/agents/`:

- `01-plan-compliance.md` -- dispatched as Agent 1
- `02-sdk-best-practices.md` -- dispatched as Agent 4
- `03-error-handling.md` -- dispatched as Agent 5
- `04-test-quality.md` -- dispatched as Agent 6
- `05-code-quality.md` -- dispatched as Agent 7
- `07-docs-deferred.md` -- dispatched as Agent 8

Read the consolidation template (dispatched sequentially after all parallel agents):

- `06-consolidation.md`

Read the 2 existing reviewer agents (dispatched as Agents 2 and 3):

- `.Codex/agents/architecture-reviewer.md`
- `.Codex/agents/theme-reviewer.md`

**Note on file numbering:** The prompt template files are numbered in the directory for readability. Agents 2 and 3 come from the existing `.Codex/agents/` directory, so template files 02-05 map to dispatch positions 4-7. Template 07 maps to dispatch position 8. The output files use the dispatch position numbers (01-08).

## STEP 4 -- Dispatch 8 Agents in Parallel

Construct 8 Task tool calls in a **single message** so they run in parallel. Each Task call:

- Uses `subagent_type: "general-purpose"`
- Uses `model: "opus"`
- **Prepend this directive to EVERY agent prompt** (before the agent's own instructions):
  > "IMPORTANT: For all file reading use the Read tool, for all content searching use the Grep tool, for all file finding use the Glob tool. Do NOT use Bash commands for these operations (no cat, grep, find, head, tail, echo). Only use the Bash tool for commands that truly require shell execution: git commands, npx vitest, npx vite build, and mkdir. This ensures you can operate without permission prompts."
- Contains the full agent prompt with these placeholders replaced:
  - `{HANDOFF_DOC_PATH}` -> the actual handoff doc path from `$ARGUMENTS`
  - `{PLAN_PATH}` -> `Docs/plans/{FEATURE_NAME}-plan.md` (or "NOT FOUND -- artifact missing" if it doesn't exist)
  - `{VALIDATION_DIR}` -> `Docs/plans/{FEATURE_NAME}-validation/` (or "NOT FOUND -- artifact missing" if it doesn't exist)
  - `{COMPLETION_PATH}` -> `Docs/plans/{FEATURE_NAME}-complete.md` (or "NOT FOUND -- artifact missing" if it doesn't exist)
  - `{CHANGED_FILES}` -> the full list of changed files from Step 2c (one per line)
  - `{FEATURE_NAME}` -> the derived feature name
  - `{OUTPUT_DIR}` -> `Docs/reviews/{FEATURE_NAME}/`

### Agent dispatch list:

**Agent 1 -- Plan Compliance**

- Prompt: contents of `01-plan-compliance.md` with placeholders replaced
- Writes to: `{OUTPUT_DIR}/01-plan-compliance.md`

**Agent 2 -- Architecture Reviewer**

- Prompt: contents of `.Codex/agents/architecture-reviewer.md` with this addition prepended:
  > "You are reviewing changes for the `{FEATURE_NAME}` implementation. Focus your review on these changed files: {CHANGED_FILES}. Write your full review output as a markdown file to `{OUTPUT_DIR}/02-architecture.md`. Start with a `# Architecture Review: {FEATURE_NAME}` heading. Use the output format from your instructions but write it to the file, not to the console."
- Writes to: `{OUTPUT_DIR}/02-architecture.md`

**Agent 3 -- Theme Reviewer**

- Prompt: contents of `.Codex/agents/theme-reviewer.md` with this addition prepended:
  > "You are reviewing changes for the `{FEATURE_NAME}` implementation. Focus your review on these changed files: {CHANGED_FILES}. Write your full review output as a markdown file to `{OUTPUT_DIR}/03-theme.md`. Start with a `# Theme Review: {FEATURE_NAME}` heading. Use the output format from your instructions but write it to the file, not to the console."
- Writes to: `{OUTPUT_DIR}/03-theme.md`

**Agent 4 -- SDK Best Practices**

- Prompt: contents of `02-sdk-best-practices.md` with placeholders replaced
- Writes to: `{OUTPUT_DIR}/04-sdk-practices.md`

**Agent 5 -- Error Handling & Correctness**

- Prompt: contents of `03-error-handling.md` with placeholders replaced
- Writes to: `{OUTPUT_DIR}/05-error-handling.md`

**Agent 6 -- Test Quality**

- Prompt: contents of `04-test-quality.md` with placeholders replaced
- Writes to: `{OUTPUT_DIR}/06-test-quality.md`

**Agent 7 -- Code Quality Catch-All**

- Prompt: contents of `05-code-quality.md` with placeholders replaced
- Writes to: `{OUTPUT_DIR}/07-code-quality.md`

**Agent 8 -- Documentation & Deferred Items**

- Prompt: contents of `07-docs-deferred.md` with placeholders replaced
- Writes to: `{OUTPUT_DIR}/08-docs-deferred.md`

## STEP 4b -- Handle Agent Failures

After all 8 agents complete, check each Task result. If any agent failed or timed out:

1. Note which agent(s) failed
2. Check if their output file was partially written (read it if it exists)
3. If an output file is missing, create a placeholder noting the agent failed:
   ```
   # [Agent Name] Review: {FEATURE_NAME}
   **STATUS: AGENT FAILED -- this review was not completed.**
   ```
4. Inform the consolidation agent which reports are missing so it can flag the gap in the coverage matrix

Do NOT re-dispatch failed agents. Proceed with whatever reports were produced.

## STEP 5 -- Dispatch Consolidation Agent (Sequential)

After ALL 8 agents complete (or fail), read brief summaries of each agent's key findings from their Task return values. Then dispatch the consolidation agent:

- Uses `subagent_type: "general-purpose"`
- Uses `model: "opus"`
- Prompt: contents of `06-consolidation.md` with placeholders replaced, PLUS brief summaries of each agent's key findings
- The consolidation agent will:
  1. Read all 8 report files from `{OUTPUT_DIR}/`
  2. Cross-reference within domains, then across domains (see consolidation prompt for domain groupings)
  3. Deduplicate findings with confidence scoring
  4. Run regression (`npx vitest run` + `cd demo-app && npx vite build` + `cd packages/docs && npx docusaurus build`)
  5. Write `{OUTPUT_DIR}/review-{FEATURE_NAME}.md` (the detailed handoff report)
  6. Write `{OUTPUT_DIR}/doc-updates-draft.md` (proposed edits to living docs)

## STEP 6 -- Verify and Report to User

After consolidation completes:

### Evidence Verification

Before presenting the summary, verify the consolidation report contains:

- [ ] Actual vitest terminal output with test counts and pass/fail status (not just "ALL PASS")
- [ ] Actual vite build terminal output with bundle stats (not just "BUILD SUCCEEDED")
- [ ] Actual docusaurus build terminal output (not just "DOCS BUILD OK")
- [ ] If any regression section contains a summary without pasted terminal output, note "REGRESSION UNVERIFIED" in the user summary and flag it

### Report to User

1. Read `{OUTPUT_DIR}/review-{FEATURE_NAME}.md`
2. Present a summary to the user:
   - Number of CRITICAL / WARNING / NOTE findings
   - Regression pass/fail (verified or unverified)
   - Any coverage blind spots (files reviewed by fewer than 2 agents)
   - Whether doc updates are recommended
   - The full path to the review file
3. Tell the user: "The review is at `{OUTPUT_DIR}/review-{FEATURE_NAME}.md` -- this file can be handed to another agent with `/implement-feature` for remediation. **DO NOT SKIP STEPS. Every phase (0 through 7) in implement-feature must be executed in order. No exceptions.**"
