# Consolidation Agent: Final Report

> **Tool usage:** Use the Read tool to read files, Grep tool to search file contents, Glob tool to find files. Do NOT use Bash for file reading or searching (no cat, grep, find, head, tail). Only use Bash for git commands and running tests/builds (npx vitest, npx vite build).

You are the consolidation agent. Your job is to read all 8 review reports, cross-reference findings within and across domains, deduplicate, run regression, and produce the single authoritative review document. This document will be handed to another agent for remediation -- it must be detailed, actionable, and self-contained.

## Input

Read these review reports from `{OUTPUT_DIR}/`:

1. `01-plan-compliance.md` -- Agent 1 findings (spec/plan compliance)
2. `02-architecture.md` -- Agent 2 findings (architecture reviewer)
3. `03-theme.md` -- Agent 3 findings (theme reviewer)
4. `04-sdk-practices.md` -- Agent 4 findings (SDK best practices)
5. `05-error-handling.md` -- Agent 5 findings (error handling & correctness)
6. `06-test-quality.md` -- Agent 6 findings (test quality)
7. `07-code-quality.md` -- Agent 7 findings (code quality catch-all)
8. `08-docs-deferred.md` -- Agent 8 findings (documentation & deferred items)

Also read:

- `internal_sdk_docs/CLAUDE.md` -- for doc update recommendations
- `internal_sdk_docs/PLAYBOOK.md` -- for doc update recommendations
- `{HANDOFF_DOC_PATH}` -- original requirements
- `{PLAN_PATH}` -- implementation plan (if available)
- `{COMPLETION_PATH}` -- completion report (if available)

## Your Process

### 1. Build the Coverage Matrix

Create a table showing which files were reviewed by which agents. Flag any file reviewed by fewer than 2 agents as a blind spot.

### 2. Domain-Grouped Cross-Referencing

Cross-reference findings **within** each domain first. Compound issues found within a domain are higher confidence because the agents share context.

**Domain A: Spec & Architecture** (Agents 1, 2, 3)

- Plan compliance + architecture violations = implementation that doesn't match spec AND breaks structural rules
- Plan compliance + theme violations = implementation that drops visual requirements
- Missing requirements + architecture gaps = features that were both unbuilt and would have been wrong anyway

**Domain B: Correctness & Quality** (Agents 5, 4, 7)

- Error handling gaps + SDK practice violations = functions that are both fragile and non-compliant
- Error handling gaps + code quality issues = same function flagged from multiple angles confirms real weakness
- Race conditions + missing type safety = unsafe concurrent access without type protection

**Domain C: Tests & Documentation** (Agents 6, 8)

- Rigged/weak tests + missing doc updates = false confidence with no documentation trail
- Test coverage gaps + deferred items = known gaps that aren't tested and might be forgotten
- Test quality issues + doc inaccuracy = the test doesn't verify the right behavior and the docs describe the wrong behavior

### 3. Cross-Domain Escalation

After within-domain analysis, cross-reference **across** domains for compound issues that are worse together:

- **Domain A + Domain B**: Architecture violation + error handling gap on same file = CRITICAL (structural problem AND fragile)
- **Domain A + Domain C**: Missing requirement + no test for it = CRITICAL (gap with no safety net)
- **Domain B + Domain C**: Bad error handling + rigged test for that function = CRITICAL (fragile code with false confidence)
- **Domain A + Domain B + Domain C**: Missing requirement + error handling gap + no test = highest severity compound issue

When compound issues are found, escalate severity:

- Two agents in same domain confirm same issue -> higher confidence, keep severity
- Two agents across domains find related issues on same file/function -> escalate one level
- Three+ agents across domains converge -> always CRITICAL

### 4. Deduplicate Findings

The same issue found by multiple agents should appear ONCE in the final report, with a note about how many agents independently found it and from which domains. Multiple independent confirmations = higher confidence.

### 5. Resolve Contradictions

If one agent says PASS and another found a violation for the same concern:

- Read the relevant code yourself to determine who is correct
- Note the contradiction and your resolution in the report

### 5.5. Cross-Stream Integration Verification

If the completion report or agent findings mention multiple work streams:

1. Read the completion report for cross-stream dependency mentions
2. For each dependency (e.g., "WS-React uses queryOrderDepth from WS-Core"):
   - Verify the consumer file actually imports the dependency (grep for the import)
   - Verify the import is used (not just imported and unused)
   - Verify the types match (consumer uses the correct type from the producer)
3. Check for silent reimplementation: did a downstream stream create its own version of something foundation already provided?
   - Grep for similar function names across work stream boundaries
4. Flag cross-stream integration issues as CRITICAL -- these are invisible to per-stream testing

### 6. Run Regression (MANDATORY -- NO OPT-OUT)

You MUST run each of the following commands and paste the COMPLETE terminal output. Do not summarize, paraphrase, or abbreviate. If a command fails, paste the full error output. There is no opt-out -- these commands MUST be executed.

```bash
npx vitest run --reporter=verbose 2>&1
```

```bash
cd demo-app && npx vite build 2>&1
```

```bash
cd packages/docs && npx docusaurus build 2>&1
```

Any failures here are CRITICAL regardless of what the code-reading agents found.

### 6.5. Completeness Verification (MANDATORY before writing output)

Before writing the final report:

1. **Severity documentation:** If any sub-agent marked a finding as CRITICAL and you are changing its severity in the final report, you MUST:
   - Read the code yourself at the specific file:line the sub-agent cited
   - Document the change: "Changed from CRITICAL to [WARNING/NOTE]: [sub-agent] found [X] at [file:line], but reading the code shows [Y]. Evidence: [what you found]."
   - If you cannot articulate specific code evidence for the change, keep the original severity.

2. **Coverage matrix:** Build a file coverage matrix showing which changed files were reviewed by which agents. Any file reviewed by fewer than 2 agents should be flagged for the user's attention in the final report under a "Coverage Blind Spots" section.

### 7. Assess Living Doc Accuracy

Incorporate Agent 8's documentation findings. If Agent 8 failed or produced no output, perform a brief check yourself:

- Are new hooks listed in the Available Hooks table?
- Are new components listed in the File Locations section?
- Are new core functions in the Core Functions list?
- Is the derived-variables selector example current?

## Output: Final Review Report

Write to `{OUTPUT_DIR}/review-{FEATURE_NAME}.md`:

```markdown
# Implementation Review: {FEATURE_NAME}

**Handoff Document:** {HANDOFF_DOC_PATH}
**Plan:** {PLAN_PATH}
**Completion Report:** {COMPLETION_PATH}
**Review Date:** {current date}
**Agents:** 8 parallel reviewers + consolidation

---

## Summary

[1-2 paragraph overview: What was built, how well it matches the handoff, overall quality assessment, and the most important findings. Note any artifacts that were missing from the expected chain.]

## Regression Results

### Tests
```

[Full npx vitest run output]

```
**Status:** ALL PASS / X FAILURES

### Build
```

[Full npx vite build output]

```
**Status:** SUCCESS / FAILURE

---

## Findings by Severity

### CRITICAL (Must Fix Before Merge)

#### C1: [Title]
- **Found by:** Agent X, Agent Y (N independent confirmations)
- **Domain:** [A: Spec & Architecture / B: Correctness & Quality / C: Tests & Documentation / Cross-domain]
- **Compound:** [If this is a compound issue, explain which findings from which agents combine and why the combination is worse]
- **File:** `path/to/file.ts:line`
- **Issue:** [What's wrong]
- **Impact:** [Why this matters]
- **Fix:** [Specific action to take]

[Repeat for each CRITICAL finding]

### WARNING (Should Fix)

#### W1: [Title]
- **Found by:** Agent X
- **Domain:** [domain]
- **File:** `path/to/file.ts:line`
- **Issue:** [What's wrong]
- **Fix:** [Specific action to take]

[Repeat for each WARNING]

### NOTE (Consider Fixing)

#### N1: [Title]
- **File:** `path/to/file.ts:line`
- **Issue:** [What's wrong]
- **Suggestion:** [What to improve]

[Repeat for each NOTE]

---

## Deferred Items

[Synthesized from Agent 8's deferred items tracking. List all known deferred work, TODOs, unresolved issues from the completion report, and pre-implementation validation issues that weren't addressed.]

| Item | Source | Severity | Tracked? |
|------|--------|----------|----------|
| ... | completion report / code TODO / validation gap | HIGH/MED/LOW | Y/N |

---

## File-by-File Changes Required

For each file that needs changes, list every required modification:

### `path/to/file.ts`
1. **Line X:** [What to change and why]
2. **Line Y:** [What to change and why]

### `path/to/file2.tsx`
1. **Line X:** [What to change and why]

---

## Missing Requirements

[Requirements from the handoff document that were not implemented or partially implemented. Include the requirement text and what's missing.]

---

## Coverage Matrix

| File | Plan | Arch | Theme | SDK | Error | Test | Quality | Docs | Issues |
|------|------|------|-------|-----|-------|------|---------|------|--------|
| path/file1.ts | Y | Y | - | Y | Y | - | Y | - | 3 |
| path/file2.tsx | Y | - | Y | - | Y | - | Y | Y | 1 |

**Blind spots:** [Files reviewed by fewer than 2 agents]

---

## Recommended Doc Updates

Changes needed in the living documentation (synthesized from Agent 8 and cross-referenced with other agents' findings):

### internal_sdk_docs/CLAUDE.md
[Specific additions, corrections, or removals needed]

### internal_sdk_docs/PLAYBOOK.md
[Specific additions, corrections, or removals needed]

---

## Remediation Summary

**Total findings:** X CRITICAL, Y WARNING, Z NOTE
**Regression:** PASS/FAIL
**Plan compliance:** X of Y requirements fully implemented
**Deferred items:** X tracked, Y untracked
**Doc updates needed:** Yes/No

**This review document can be provided as input to `/implement-feature` for remediation of the findings above.**
```

## Output: Doc Updates Draft

Also write to `{OUTPUT_DIR}/doc-updates-draft.md`:

```markdown
# Proposed Documentation Updates

Based on the implementation review of {FEATURE_NAME}.

## internal_sdk_docs/CLAUDE.md

### Additions

[Exact text to add, with the section it belongs in]

### Corrections

[Exact text to change, with before/after]

### Warnings to Add

[New patterns or anti-patterns discovered during review that should be documented]

## internal_sdk_docs/PLAYBOOK.md

### Additions

[Exact text to add, with the section it belongs in]

### Corrections

[Exact text to change, with before/after]
```

**IMPORTANT:** The final review document must be SELF-CONTAINED and ACTIONABLE. Another agent reading only this file should be able to understand every finding and implement every fix without needing to read the individual agent reports. Every finding must have a file:line reference and a specific fix description.
