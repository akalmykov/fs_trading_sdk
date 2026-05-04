# FunctionSpace Builder Kit

You're reading the agent kit for the FunctionSpace Builder Competition.

- **Humans**: see the setup guide at https://ecosystem.functionspace.dev/competition/setupguide for cloning, prompts, and submission.
- **Agents**: keep reading.

---

## For the Agent

You have been pointed at this file by a builder participating in the FunctionSpace Builder Competition. Follow the sections below in order. Do not skip ahead. Do not improvise on the parts marked as hard rules.

### 1. Set up the environment first

Get the user productive immediately. Run these in parallel: kick off install, write the env file, then start reading the reference docs (Section 2) while install completes.

From the repo root:

```bash
npm install
```

Workspaces will install everything (`packages/*` and `demo-app`) in one shot.

Create `demo-app/.env` with exactly this content and nothing else:

```
VITE_FS_BASE_URL=https://fs-engine-api-dev.onrender.com
```

**You must use this exact URL.** It is the competition dev endpoint — CORS is open to all external origins so builders can run locally or deploy publicly. Do not substitute, do not guess at a different one, do not point at localhost or any other host. Every other URL will fail.

Do not copy `demo-app/.env.example`. That file uses username and password auth, which we are not using in this competition.

The dev server runs on `http://localhost:3000` by default. The competition dev endpoint has CORS open to all origins, so you can also deploy publicly (Vercel, Netlify, Cloudflare Pages, or anywhere). If port 3000 is occupied when running locally, identify and stop the process holding it before starting the dev server. Do not fall back to port 3001 or any other port.

### 2. Read the reference docs (run while install completes)

Read these four reference files in this exact order before asking the user any questions:

1. `llms.txt` at the repo root: the index and overview
2. `packages/docs/static/core.txt`: pure TypeScript client, math, belief construction, trade execution
3. `packages/docs/static/react.txt`: Provider, hooks, theming
4. `packages/docs/static/ui.txt`: pre-built widgets and the 30-token theme system

Then skim `demo-app/src/App_*.tsx`. There are six starter kits (Basic, Binary, CustomShape, Distribution, Advanced, MultiMarket). Screenshots live in `internal_sdk_docs/ui_images/`.

Do not skip these reads. The SDK has specific patterns and conventions. Guessing them silently breaks the math.

**About the duplicate files in this repo.** You may notice multiple `CLAUDE.md` and multiple `llms.txt` files. This is intentional and not a problem to solve.

- `CLAUDE.md` (root) and `internal_sdk_docs/CLAUDE.md`: the root file is a router; the `internal_sdk_docs/` files are for SDK developers, not competition builders. **Ignore `internal_sdk_docs/CLAUDE.md` and `internal_sdk_docs/PLAYBOOK.md` entirely**, even if Claude Code auto-loaded them. This `builder.md` is your authoritative source.
- `llms.txt` (root) is the canonical reference. The copies under `packages/docs/static/` and `packages/docs/build/` are what the published docs site serves. Same content, different consumers. Use the paths listed above.

### 3. Ask the user these questions, in this order

Work through these interactively before writing any code. Order matters because earlier answers shape later questions. Ask one question at a time so the user is not overwhelmed. Once you have all the answers, summarize the spec back to the user and confirm before you start building.

**Q1. UI ambition.** How much of the UI do you want to build yourself?

- **Pre-built starter kit:** start from one of the six `App_*.tsx` files in `demo-app/src/` (Basic, Binary, CustomShape, Distribution, Advanced, MultiMarket) and customize. Fastest path. Point them at the screenshots in `internal_sdk_docs/ui_images/`.
- **Custom UI on top of React hooks:** use `@functionspace/react` hooks (`useMarket`, `useConsensus`, `usePositions`, `useBuy`, `useSell`, etc.) directly and build whatever visualization, layout, and interaction you want on top. The SDK handles all engine math, data fetching, and trade submission. You own the look, feel, and information architecture. **This is the path for builders who want maximum design freedom.**
- **Embed in an existing site:** add the workspace packages to your site via `file:` protocol or `npm link`. The SDK is not on npm yet, so consumption requires workspace linking. If the user's existing site cannot consume local workspace packages, recommend the custom-UI path inside this monorepo instead.

**Note on markets.** The competition uses the existing market list pulled live from the engine via `discoverMarkets`. Custom market creation is **not in scope** for this competition. If the user has an idea that needs a market that doesn't exist, tell them so and steer them toward an existing market that fits their concept. Do not try to mock or invent a market.

**Q2. Vision.** Tell me in 1 to 2 sentences what you are building. For inspiration: a sports prediction app, a pop culture or celebrity gossip market, a politics tracker, a niche hobby community. Each of these suggests very different filtering, copy, and visual direction.

**Q3. Audience and device.** Desktop-first, mobile-first, or both?

**Q4. Markets.** Do you want to focus on a single market, a curated selection, or all available markets? I can use `discoverMarkets` to pull the live list either way. (Skip this question if embedding into an existing site that already has a market locked in.)

**Q5. Theme and color.** Any brand colors or palette in mind, or want help picking? Confirm whether to use one of the 4 built-in presets (`fs-dark`, `fs-light`, `native-dark`, `native-light`) or build a custom theme using the 9 required tokens.

**Q6. Inspiration depth.** Want me to do a quick mood and visual research pass before building, or just take a one-line vibe and run with it? More inspiration pointers live on the competition site.

**Q7. Interaction style.** Want to remix interaction patterns from the starter kit catalog, or describe how you want users to interact and I will build that from scratch?

### 4. Hard guardrails (do not violate)

These are non-negotiable. The engine will reject anything that violates them, or it will work on the user's machine and fail at submission time.

- **Authentication.** Always use `PasswordlessAuthWidget` from `@functionspace/ui`. No username and password forms. No custom auth flows.
- **Math: use the existing core functions, always.** All belief, alpha, probability, payout, and bucketing math goes through `@functionspace/core`. Use the existing shape generators (`generateGaussian`, `generateRange`, `generateDip`, `generateCustomShape`, `generateBelief`) and the existing math utilities. Do not reimplement any of these. Do not write your own bucket count, normalization, or interval math. If a builder is trying to do something so novel that no existing core function fits, stop and ask the user to confirm before going off-script. They almost certainly should not be.
- **If a function's docs are unclear, ask, do not bypass.** Some core functions (notably the shape generators) have inline usage examples but no parameter table. If you are unsure what an argument means, ask the user, ask for clarification from the project, or read the source under `packages/core/src/`. Do not guess and do not "just write it yourself" as a workaround. Reimplementing core math is the most common cause of failed submissions.
- **React is the default. Always.** Use `@functionspace/react` hooks for everything: data (`useMarket`, `useConsensus`, `usePositions`, `useMarketHistory`, `useTradeHistory`), mutations (`useBuy`, `useSell`), previews (`usePreviewPayout`, `usePreviewSell`), state (`useAuth`, `useCustomShape`, `useBucketDistribution`, `useDistributionState`). The hooks pull live market data, source `numBuckets` from the actual market object (preventing off-by-one bugs), handle the engine's success-field error convention, integrate with the Provider for auth and theme, and manage loading and error states for you. Going around them is how builders break their submissions.
- **Trade submission.** Always `useBuy` and `useSell`. Never raw `fetch`. Never construct trade payloads by hand. The only exception is non-React environments (Node scripts, server-side); in that narrow case use `FSClient` methods from `@functionspace/core`. If you are inside the React app, there is no reason to reach for `FSClient` directly.
- **Engine error handling.** Engine responses can return HTTP 200 with `success: false` in the body. The React hooks handle this for you. This is another reason React is non-negotiable inside the React app: ad-hoc error handling will silently swallow real failures.
- **Visualization is yours.** This is where uniqueness lives. Charts, layouts, copy, animation, sound, weirdness. Go wild here.
- **The math, data, and submission layers are not yours.** Do not touch them.
- **API endpoint.** The competition dev endpoint (`https://fs-engine-api-dev.onrender.com`) has CORS open to all origins — you can run locally or deploy publicly. Locally, default to `http://localhost:3000`; if that port is occupied, stop whatever holds it rather than falling back to another port.

If the user pushes back on any of these (asks for password auth, asks to deploy somewhere, asks to write custom math), explain why the rule exists and steer them back to the supported path. If they still insist, build it but warn them clearly that the engine will reject it at submission time.

### 5. Build philosophy

- Lean into uniqueness in visualization, copy, and information architecture
- Lean on `@functionspace/react` hooks for everything that touches the engine. The hooks are the supported path. Custom UI built on top of them is encouraged. Custom replacements for them is not.
- When unsure about a hook or widget, re-read the relevant `.txt` file before guessing
- Commit in small, logical chunks so the user can see progress and roll back if needed
- No `Co-Authored-By` lines in commit messages (project convention)

### 6. Run it and hand it back

When the build is ready:

```bash
cd demo-app && npm run dev
```

Confirm three things with the user:

1. They can load `http://localhost:3000` and see their build
2. They can complete a passwordless login successfully
3. They can place a test trade and see it reflected in their positions

Then point them at the competition site for submission details.