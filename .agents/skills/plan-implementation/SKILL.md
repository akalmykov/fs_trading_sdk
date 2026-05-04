---
name: plan-implementation
description: Use when a new SDK feature needs planning before implementation -- either extracting an existing widget from a codebase or designing a greenfield feature from scratch
user_invocable: true
argument-hint: <source-path-or-feature-description>
---

# Plan Implementation

You are the **orchestrator** for a planning pipeline that produces validated implementation plans for the FunctionSpace Trading SDK. You take either a pointer to existing UI code or a feature idea and produce a plan in the exact format that `/implement-feature` consumes.

**NEVER SKIP ANY PHASE.** Every phase (0 through 6) must be executed in order, even if:
- You believe Phase 0 docs haven't changed -- read them again, they are living documents
- Clarifying questions seem obvious -- ask them anyway; assumptions cause the most waste
- Research seems redundant from prior context -- dispatch agents anyway; context compression loses details
- The plan seems correct without validation -- validate anyway; validators catch what you miss

**The plan provides context, justifications, architectural reasoning, and intended outcomes -- not specific code changes.** The implementation agents downstream validate assertions, appraise suggestions, and propose their own code.

## Architecture

```
User invokes /plan-implementation with either:
  - Mode A: "Extract the order depth widget from fs_demo" (points to files/locations)
  - Mode B: "I want to add a portfolio summary widget" (describes an idea)

/plan-implementation
  |
  +-- PHASE 0: Read living docs (AGENTS.md, PLAYBOOK.md, REACT_ROADMAP.md)
  +-- PHASE 1: Determine mode (A or B), ask clarifying questions
  |
  +-- [MODE A] PHASE 2A: Extraction
  |     +-- Discovery agents (parallel) -- find all related files
  |     +-- Data pipeline mapping -- trace API to render
  |     +-- SDK-readiness assessment
  |     +-- Visual fidelity + improvement opportunities
  |     +-- Write requirements doc
  |
  +-- [MODE B] PHASE 2B: Greenfield
  |     +-- Invoke superpowers:brainstorming (formal, not optional)
  |     +-- Extract requirements from approved design
  |     +-- Write requirements doc
  |
  +-- PHASE 3: Research (4 parallel agents, both modes)
  +-- PHASE 4: Write the plan (8 mandatory sections)
  +-- PHASE 5: Validate the plan (3 parallel validators)
  +-- PHASE 6: User approval checkpoint
  |
  +-- Output: Docs/plans/<feature-name>-plan.md (validated, approved)

User then runs:
  /implement-feature Docs/plans/<feature-name>-plan.md
```

**This skill does NOT replace any part of implement-feature.** Implement-feature keeps its full Phase 0-7 pipeline. The first draft is never good enough -- double validation catches what single validation misses.

---

## PHASE 0 -- Read Living Docs (MANDATORY, NEVER SKIP)

Before doing ANYTHING else, read these three files completely:

1. `internal_sdk_docs/AGENTS.md` -- Architecture rules, layer boundaries, theming system, testing requirements, doc update matrix
2. `internal_sdk_docs/PLAYBOOK.md` -- SDK Expansion Checklist, step-by-step guides, existing widget/hook/function reference, file locations, naming conventions
3. `internal_sdk_docs/REACT_ROADMAP.md` -- React layer evolution, caching strategy, hook patterns

These are the source of truth. Every decision in the plan must be grounded in these docs. If existing source code does something differently, the SDK plan follows the living docs, not the source code.

---

## PHASE 1 -- Determine Mode and Clarify

### Determine Mode

Parse `$ARGUMENTS` and the user's input:

- **If the user points to existing files, widgets, or features in a codebase** (e.g., "extract the order depth chart from fs_demo", "the distribution tab in belief-composability") -> **Mode A: Extraction**
- **If the user describes a new feature idea** (e.g., "I want to add portfolio analytics", "we need a trade history export") -> **Mode B: Greenfield**
- **If unclear** -> Ask: "Are we extracting an existing feature from a codebase, or designing something new?"

### Ask Clarifying Questions (Both Modes)

Before proceeding, resolve ambiguity. Ask about:

- **Scope** -- "Should I include [related feature X] or just the [core widget]?"
- **Tab/navigation context** -- "This widget is part of a tabbed view with [N other tabs]. Should I include the tab system?"
- **Dependencies** -- "Does this need a new core function before a hook? A hook before a widget?"
- **Existing SDK overlap** -- "I see the SDK already has [similar function/hook]. Should we extend it or create something new?"
- **Backend completeness** -- (Mode A) "The data comes from [endpoint]. I notice [gap]. Should I document what the backend needs?"
- **Duplicate implementations** -- (Mode A) "I found this same logic in [file A] and [file B]. Which should I treat as authoritative?"

Do NOT proceed to Phase 2 with unresolved questions. Ask too many questions rather than assume incorrectly.

---

## PHASE 2A -- Extraction (Mode A)

### Context: Source Codebases

The primary source is `fs_demo/`, a React + Vite frontend:

```
fs_demo/
  src/
    components/          # All UI components
      trading_widgets/   # Shape cutter, trade panels, etc.
      market_data/       # Time & sales, market feeds, etc.
      walkthrough/       # Guided walkthrough experience
        belief-composability/  # Visualizer system
          visualizers/
            utils/       # Pure data transformation functions
    lib/                 # Shared utility libraries (beliefVector.js, etc.)
    services/            # API client (apiService.js)
    pages/               # Page-level components
```

The backend is `fs_core/` (Python/FastAPI):

- `fs_core/api/` -- API endpoint definitions
- `fs_core/core/core.py` -- Core market logic
- `fs_core/db/` -- Database layer

### Step 1: Discovery (3 Parallel Agents)

The user provides minimal pointers -- file names, component names, or descriptions of where to look. Dispatch 3 discovery agents in a single message:

**Agent 1: Component tree + visual fidelity discovery**

```
Explore the codebase starting from [component the user named].

1. Read the component file. Note all imports and props.
2. Trace UPWARD: find parent components that render this one. For each parent:
   - What props does it pass down?
   - Does it manage state (useState, useReducer)?
   - Does it fetch data (API calls, useEffect)?
   - Keep tracing up until you find the data source.
3. Trace DOWNWARD: find all imported sub-components, utility functions, and libraries.
4. Map the full component hierarchy as a tree.
5. VISUAL FIDELITY EXTRACTION (critical for UI components):
   a. Record every user-visible text string VERBATIM (labels, headings, button text, status text, placeholder text). Copy the exact text, do not paraphrase.
   b. Record exact font sizes and weights -- translate Tailwind classes to CSS values (text-2xl = 1.5rem, font-semibold = 600, etc.)
   c. Record exact spacing: padding, margin, gap, min-height, max-width values from Tailwind or inline styles.
   d. Record icon library and exact icon names (e.g., lucide-react: TrendingUp, Droplets, Users). For each icon, extract the SVG viewBox and path data so the SDK can inline them without depending on the icon library.
   e. Record exact layout configuration: flex ratios, grid templates, alignment, justify, wrap behavior.
   f. Record interactive CSS: hover transforms, transition durations, gradients, box-shadow values.

Return: component tree with file paths, each component's role, data source chain, AND a visual fidelity table with every text string, size, spacing, icon, and layout value extracted from the source.
```

**Agent 2: Data pipeline discovery**

```
Find the complete data pipeline for [feature the user described].

1. Search apiService.js (or equivalent service file) for API calls related to [feature].
2. For each API call: document the endpoint URL, params, and response shape.
3. Check fs_core/api/ for the backend endpoint definition. Document the server-side contract.
4. Trace from API response through any data transformations to the final rendered output.
5. Identify all intermediate computations (useMemo, utility functions, derived state).

Return: full data flow diagram from API to render, with types at each step.
```

**Agent 3: Duplication and alternatives discovery**

```
Search for duplicate implementations and existing SDK equivalents for [feature].

1. For each function/utility found by other agents, search the codebase for the same function name in other files.
2. If duplicates exist: read all versions, identify the most complete/correct one.
3. Check packages/ in fs_trading_sdk for any existing SDK functions that do similar work.
4. Note shared utilities in fs_demo/src/lib/ that multiple components use.

Return: duplication map (function name -> all file locations -> best version), existing SDK equivalents.
```

### Step 2: Data Pipeline Mapping

Synthesize discovery findings into a complete data flow:

```
API endpoint -> service function -> parent component state ->
  -> transformation/computation -> child component props -> rendered output
```

For each step, document:

- What data enters (types, shape)
- What transformation happens (exact algorithm if non-trivial -- include the code)
- What data exits (types, shape)
- Where state lives (useState, context, props)
- What interactive controls exist (sliders, toggles, inputs -- with types, ranges, defaults)

### Step 3: SDK-Readiness Assessment

For each file discovered, classify:

| Classification      | Meaning                                    | SDK Treatment                         |
| ------------------- | ------------------------------------------ | ------------------------------------- |
| **SDK-Ready**       | Pure function, no UI deps, clean interface | Port to `packages/core/`              |
| **Partially Ready** | Clean props but UI-library-locked          | Port logic, reference UI pattern      |
| **Not Ready**       | Coupled to demo layout, mixed concerns     | Extract logic, design new interface   |
| **Trivial**         | Few lines, easily reimplemented            | Document pattern, don't port          |
| **Duplicate**       | Same logic in multiple files               | Pick best version, note all locations |

### Step 4: Visual Fidelity Requirements

**The SDK widget must be visually identical to the source.** The user should not be able to tell them apart. This means COPYING detail from the source, not summarizing or paraphrasing it.

**Text content -- copy exactly, do not paraphrase:**

- Read every user-visible string in the source component (labels, headings, placeholder text, button text, status text)
- Record them VERBATIM in the requirements doc. If the source says "Liquidity", the requirements must say "Liquidity" -- not "Pool" or "Balance" or any synonym
- Include the exact casing (uppercase, title case, sentence case) as it appears in the source

**Typography -- extract exact values:**

- For every text element, record the source's font size, font weight, and line height. Translate Tailwind classes to CSS values (e.g., `text-2xl` = `1.5rem`, `font-semibold` = `600`)
- Record min-height, padding, and margin values that affect layout proportions (e.g., `min-h-[92px]` = `min-height: 92px`)
- These values go in the requirements doc as a table, not as prose descriptions

**Icons -- extract exact SVG paths:**

- If the source uses an icon library (lucide-react, heroicons, etc.), record the exact icon name AND extract the SVG `<path>` data from the library
- The SDK must not depend on the icon library, so the implementation agent needs the raw SVG paths to inline. Provide them in the requirements doc.
- If you cannot extract the SVG paths during planning, provide the exact icon library name and icon name so the implementation agent can look them up

**Layout structure:**

- ASCII diagram of the widget (existing requirement)
- For EACH section of the layout: exact padding, margin, gap values from the source
- Flex/grid configuration: exact ratios, column templates, alignment

**Spacing, sizing, proportions:**

- Do not write "the header has some vertical space." Write "the header has `min-height: 92px` and `padding-bottom: 1rem`"
- Every dimension that affects visual appearance must be a concrete number, not a description

**Color mapping:**

- Source Tailwind classes -> SDK theme tokens (`var(--fs-*)` in CSS, `ctx.chartColors.*` in Recharts SVG props)
- For gradients: record the exact gradient definition (e.g., `linear-gradient(to right, var(--fs-primary), var(--fs-accent))`)

**Interactive behaviors:**

- Hover states, click actions, transitions, animations with exact CSS values (duration, easing, transform)

**The standard for this section is: an implementation agent reading only the requirements doc should be able to reproduce the source widget pixel-for-pixel without ever reading the source file.** If they would need to look at the source to get a detail right, that detail is missing from the requirements.

### Step 5: Improvement Opportunities

While analyzing the source, identify improvements the SDK version should make:

- **Responsive behavior** -- does the source handle screen resize? If not, the SDK version should (Recharts ResponsiveContainer, flexible layouts, breakpoint-aware sizing)
- **Accessibility** -- keyboard navigation, screen reader support, ARIA labels
- **Performance** -- unnecessary re-renders, large data set handling, memoization
- **Error handling** -- the SDK widget MUST be self-contained with loading/error states (per AGENTS.md)
- **Edge cases** -- empty data, single data point, extreme values

Flag these as "SDK improvements over source" in the requirements doc.

### Step 6: Write Requirements Doc

Write to `Docs/<feature-name>-requirements.md`:

```markdown
# Requirements: <Feature Name>

## Source

- Source codebase: [path]
- Primary component: [path]
- Related files: [table with path, purpose, SDK-readiness]

## Data Pipeline

[Full flow diagram from Step 2, with types at each stage]

## Core Algorithms

[Exact math with code for each non-trivial computation.
Include function signature, input types, output types, mathematical details.
This is the most important section -- be precise, not approximate.]

## API Contract

[Endpoints, query params, request body, response shape.
Note any backend gaps -- endpoints that exist in DB but aren't wired to API.]

## Visual Specification

[Layout diagram (ASCII), chart config, interactive controls]
[Visual fidelity: must be identical to source]
[Color mapping: Tailwind -> SDK theme tokens]

## SDK-Readiness Assessment

[Classification table from Step 3]

## Recommended SDK Structure

[TypeScript interfaces for each layer per AGENTS.md architecture:

- Core: pure functions and types (reference PLAYBOOK patterns)
- React: hook interface with options and return type (reference canonical hook pattern)
- UI: optional component props interface (reference existing widget pattern)
  Include 3 developer usage examples:

1. Full SDK pipeline (hook + component)
2. Just the math (core function + custom UI)
3. Fully custom (raw API + own everything)]

## Improvement Opportunities

[List from Step 5 with priority: responsive, accessibility, performance, error handling, edge cases]

## Duplication Analysis

[From Agent 3: what's duplicated, where, which is the best version]

## Cross-References

[Relationships to other features/requirements -- shared types, data flow connections]

## Testing Checklist

[Specific test cases: happy path, error path, edge cases, interactive controls]
```

---

## PHASE 2B -- Greenfield (Mode B)

### Step 1: Invoke Brainstorming (FORMAL, NOT OPTIONAL)

Invoke the `superpowers:brainstorming` skill. This will:

1. Explore project context (read SDK files, docs, recent work)
2. Offer visual companion if the feature involves visual questions
3. Ask clarifying questions one at a time
4. Propose 2-3 approaches with trade-offs and recommendation
5. Present design in sections, get user approval after each
6. Write design doc with spec review loop
7. Save design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`

Wait for the brainstorming skill to complete and the user to approve the design.

### Step 2: Extract Requirements

From the approved design doc, extract:

- What SDK layers are affected (core/react/ui)
- What new functions, hooks, or components are needed
- What existing SDK primitives can be reused or extended
- What the developer API should look like (usage examples)
- What types and interfaces are needed
- What test cases should cover

### Step 3: Write Requirements Doc

Write to `Docs/<feature-name>-requirements.md`:

```markdown
# Requirements: <Feature Name>

## Design Source

Design doc: [path to brainstorming output]

## Feature Description

[What it does, who it's for, how it fits into the SDK]

## Recommended SDK Structure

[TypeScript interfaces for each layer per AGENTS.md architecture
Reference PLAYBOOK.md patterns for each layer]

## Developer Usage Examples

[3 patterns: full SDK pipeline, just the math, fully custom]

## Existing Primitives to Reuse

[SDK functions/hooks/types that already exist and should be used]

## Testing Checklist

[Specific test cases]
```

---

## PHASE 3 -- Research (Both Modes, 4 Parallel Agents)

After the requirements doc is written (from either mode), dispatch 4 research agents in a single message:

**Agent 1: Pattern discovery**

```
Find and summarize the implementation pattern for the closest existing [widget/hook/function] to [feature being planned].

1. Read internal_sdk_docs/PLAYBOOK.md to identify the closest existing implementation
2. Read that implementation file completely
3. Describe its structure: file layout, imports, function signatures, return types
4. Note how it follows the PLAYBOOK's canonical patterns
5. Identify which parts of the pattern apply to the new feature and which don't

Return: pattern summary with file path, structure description, and applicability notes.
```

**Agent 2: Integration points**

```
What files would need to change to add a new [widget/hook/function] to the SDK?

1. Read internal_sdk_docs/PLAYBOOK.md -- find the SDK Expansion Checklist for [type]
2. Check each index.ts barrel file in the affected packages (core, react, ui)
3. Check tests/architecture.test.ts for export verification patterns
4. Check packages/ui/src/styles/base.css for derived-variables selector
5. List every file that needs modification with what change is needed

Return: complete file change list with the PLAYBOOK checklist items mapped to specific files.
```

**Agent 3: Type landscape**

```
What types and interfaces exist in the area of [feature]?

1. Search packages/core/src/ for relevant type definitions
2. Check if types needed for this feature already exist (can be reused)
3. Check if types need to be extended or if new types are needed
4. Verify type export chains (definition -> barrel -> package index)

Return: existing types with file paths, reuse recommendations, new types needed.
```

**Agent 4: Test patterns**

```
Find and read the test suites most relevant to [feature type: hook/widget/core function].

1. Read tests/hooks.test.tsx -- describe test structure, assertion patterns, mocking
2. Read tests/components.test.tsx -- describe test structure, assertion patterns, mocking
3. Read tests/architecture.test.ts -- how are new exports verified?
4. Read Docs/plans/react-tier-1-roadmap_uplift/tier1-step3-test-quality/tier1-step3-test-quality-plan.md -- the quality standard

Tests must assert on SPECIFIC content (not toBeTruthy/toBeDefined). Document:
- describe/it nesting pattern
- Mocking patterns (vi.mock, vi.fn, renderHook)
- Edge cases covered (loading, error, empty data, cleanup, provider guards)
- The specific quality standard from the uplift doc

Return: test pattern summary with examples from existing tests.
```

---

## PHASE 4 -- Write the Plan

Using the requirements doc and research findings, write the implementation plan to:

```
Docs/plans/<feature-name>-plan.md
```

**The plan must include these 8 mandatory sections:**

### 1. Context

What is being built and why. Reference the requirements doc path.

### 2. Input Source

`Docs/<feature-name>-requirements.md`

### 3. Affected Layers

Which packages will be modified (core, react, ui) and what's being added/changed in each. Ground in AGENTS.md's layer architecture.

### 4. Work Streams

Break into parallel-safe work streams. Each must have:

- **Name and description**
- **File ownership** -- exact list of files to `CREATE` or `MODIFY` (use these prefixes). Full paths like `packages/core/src/queries/queryOrderDepth.ts`, not abbreviations.
- **Zero file overlap** with other work streams
- **Ordered steps** with specific file paths and concrete details (not "add a hook" but "create `useOrderDepth` hook following the `useMarket` canonical pattern with these fields: ...")
- **PLAYBOOK checklist reference** -- which SDK Expansion Checklist applies
- **Pattern reference** -- specific existing file to use as template
- **Wiring checklist** -- every new item with its consumer:

| Created | Consumed By (file + location) |
| ------- | ----------------------------- |

Rule: If a created item has no consumer, it is dead code. Remove it.

### 5. Work Stream Dependencies

Which streams must complete before others. Must be a DAG (no circular dependencies).

### 6. Foundation Stream

Which stream(s) run first. Typically: types/core -> hooks/react -> widgets/ui.

### 7. Testing Strategy

Which test files to update, what test cases to add, assigned to owning work streams. Tests must follow the quality standard:

- Specific content assertions (not toBeTruthy/toBeDefined)
- Provider guard tests with `.toThrow('must be used within FunctionSpaceProvider')`
- Loading/error state tests checking specific text or CSS classes
- Architecture test updates for all new exports

### 8. Doc Updates Required

Which AGENTS.md and PLAYBOOK.md sections need updating. Cross-reference the doc update matrix in AGENTS.md:

| What changed              | Update in...                                                             |
| ------------------------- | ------------------------------------------------------------------------ |
| New widget                | PLAYBOOK.md -- Widget Reference, File Locations                          |
| New hook                  | PLAYBOOK.md -- Available Hooks; AGENTS.md -- test table if new test file |
| New core function         | PLAYBOOK.md -- Core Functions list (correct category)                    |
| New CSS widget root class | PLAYBOOK.md -- derived-variables selector example                        |
| New/changed public API    | llms.txt + packages/docs/docs/ Docusaurus pages                          |

**Plan quality guidance:**

- File paths must be exact and complete
- Pattern references must point to actual files the validators can read
- Export statements should be literal (e.g., `export { queryOrderDepth } from './queries/queryOrderDepth.js';`)
- Function signatures should include parameter types and return types
- Every assertion must be verifiable against the codebase
- Ground every decision in AGENTS.md and PLAYBOOK.md rules

---

## PHASE 5 -- Validate the Plan (3 Parallel Validators)

Read the three validator agent prompts from `.Codex/skills/implement-feature/agents/`:

- `validator-codebase.md`
- `validator-gaps.md`
- `validator-conventions.md`

Create an output directory:

```bash
mkdir -p Docs/plans/<feature-name>-validation/
```

Dispatch all 3 validators in a **single message**. Each validator:

- Uses `subagent_type: "general-purpose"`
- Uses `model: "opus"`
- Gets the full agent prompt with placeholders replaced:
  - `{PLAN_PATH}` -- path to the plan file from Phase 4
  - `{OUTPUT_DIR}` -- `Docs/plans/<feature-name>-validation/`
- Prepend this directive to every agent prompt:
  > "IMPORTANT: For all file reading use the Read tool, for all content searching use the Grep tool, for all file finding use the Glob tool. Do NOT use Bash commands for these operations (no cat, grep, find, head, tail, echo). Only use the Bash tool for commands that truly require shell execution: git commands, npx vitest, npx vite build, and mkdir."

After all 3 validators complete:

1. Read their output files
2. Synthesize findings into corrections
3. Update the plan file with corrections
4. If critical errors exist (phantom file references, missing SDK Expansion Checklist items, layer violations), fix the plan and consider re-validating the corrected sections

---

## PHASE 6 -- User Approval

Present the validated plan to the user:

> **Plan validated and saved to `Docs/plans/<feature-name>-plan.md`.**
> **Requirements doc: `Docs/<feature-name>-requirements.md`**
> **Validation results: `Docs/plans/<feature-name>-validation/`**
>
> [Summary: what the plan covers, how many work streams, execution order]
> [Corrections: any issues found by validators and how they were fixed]
> [Decisions: any open questions that need user input]
>
> **Artifacts produced by this planning session:**
>
> - Requirements doc: `Docs/<feature-name>-requirements.md`
> - Implementation plan: `Docs/plans/<feature-name>-plan.md`
> - Validation results: `Docs/plans/<feature-name>-validation/`
>
> The plan references the requirements doc in its "Input Source" section.
> implement-feature will read both during its own Phase 1.
>
> **To implement, run:**
>
> `/implement-feature Docs/plans/<feature-name>-plan.md`
>
> **DO NOT SKIP STEPS. Every phase (0 through 7) in implement-feature must be executed in order. No exceptions.**

---

## Key Context: fs_demo Codebase (Mode A Reference)

### Code Duplication is Rampant

The demo app has significant duplication. The same mathematical function (e.g., `gaussian()`, `normalizeVector()`, `generateBellShape()`) may exist in 3+ files with slight variations. When found:

1. Note ALL locations
2. Identify the "best" version (most complete, best documented)
3. The SDK must deduplicate -- use only the best version

### Charting Library: Recharts

Nearly all charts use Recharts (`BarChart`, `ComposedChart`, `AreaChart`, `LineChart`, `ResponsiveContainer`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid`, `Legend`, `Cell`, `LabelList`).

SDK guidance: UI components use Recharts, but core/hooks layers must be chart-library-agnostic. Document chart configuration so developers using other libraries can replicate it.

### Styling: Tailwind -> SDK Theming

Source uses Tailwind utility classes. SDK uses CSS custom properties (`var(--fs-*)`). Document visual specs in terms of what they ARE (spacing, colors by purpose, font sizes), not the Tailwind classes used. Colors in Recharts SVG props must use `ctx.chartColors.*`, never CSS variables.

### API Service Centralization

All API calls go through `fs_demo/src/services/apiService.js`. Cross-reference both `apiService.js` (frontend call) and `fs_core/api/` (backend endpoint) when documenting API contracts.

### Core Domain Concepts

- **Belief vector (pVector):** K+2 dimensional array of non-negative numbers summing to K+2 (where K = numBuckets). Represents probability distribution over market outcome range [L, H].
- **Consensus PDF:** Market's aggregate probability distribution. Fetched via `GET /market/consensus_pdf`. Returns `{x_values, y_values, market_params}` where `y_values` are probability density (not mass).

### Existing Handoff Documents (Format Reference)

These in `Docs/` show what thorough requirements look like:

- `shape-cutter-handoff.md` -- 8-shape belief generator + custom freeform shape
- `time-and-sales-handoff.md` -- Trade tape / time & sales widget
- `distribution-chart-handoff.md` -- Aggregate distribution bar chart + tab system
- `dynamic-binary-handoff.md` -- Configurable binary option

---

## Reminders

- **No em dashes** anywhere ever
- **Living docs are the source of truth** -- AGENTS.md, PLAYBOOK.md, REACT_ROADMAP.md. Read them. Ground decisions in them.
- **Visual fidelity is non-negotiable** (Mode A) -- the SDK widget must look identical to the source
- **Plans provide context and outcomes, not code** -- implementation agents make their own code decisions
- **Double validation** -- this skill validates, implement-feature validates again. First draft is never good enough.
- **Ask questions when uncertain** -- it is better to ask too many than to assume incorrectly
- **Core is chart-library-agnostic** -- pure TypeScript, no React, no Recharts in packages/core/
- **Hooks follow the canonical pattern** -- context check, useQueryCache, CacheKey, useCallback with AbortSignal, useCacheSubscription, return `{ <named>, loading, isFetching, error, refetch }`
- **Widgets are self-contained** -- own loading/error states, data through hooks, styles in base.css
- **Theme tokens only** -- `var(--fs-*)` in CSS, `ctx.chartColors.*` in SVG, never hardcoded colors
