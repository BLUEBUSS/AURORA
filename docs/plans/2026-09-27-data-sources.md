# Data Source Settings Implementation Plan

> Execution workflow: superpowers:executing-plans, serial execution in the existing AURORA feature branch. User authorized execution after design. No new worktree, commit or publication needed.

**Goal:** Users can configure, test, disable and remove their own SEC, EODHD, Alpha Vantage and FRED access, and research tools actually use those settings.

**Architecture:** A dedicated local DataSourceStore owns encrypted per-provider secrets and sanitized status metadata. Existing local session/Origin security protects its routes. Research captures a provider configuration snapshot at run start; shared model configuration lock prevents conflicting updates. Existing provider implementations consume only this explicit whitelist.

**Tech Stack:** TypeScript, React, existing Pi tools, Node HTTP, Windows DPAPI, Vitest and Playwright.

## User flow and decisions

Settings gains a Data Sources tab, matching current day/night themes. Four compact expandable provider rows show purpose, status and last explicit test time. Fields are empty password inputs after saving; blank retains the existing secret. Save does not trigger network traffic. Test Saved Configuration explicitly calls the provider and may use API quota. Enable/disable retains credentials; removal deletes them. No automatic tests on opening the page.

SEC asks for application/contact identity, not an API key. Import a previously saved SEC identity once from model settings if no data-source store exists; an explicit removal must not recreate it. Models tab points to Data Sources. Kimi search is a read-only summary using the configured model; public crypto interfaces do not require users to invent credentials.

States: unconfigured, disabled, configured but untested, successful last probe, authentication/permission, quota/rate limit, timeout/network, invalid/no data. Test success is limited to the sampled endpoint and timestamp. Unconfigured sources do not prevent use of public web search. First release scope excludes crypto paid keys, proxy UI and additional search providers.

## Task 1: Store and API

Create runtime/data-sources/{catalog,store,probe,routes,index}.ts. Add store tests first covering secret non-disclosure, per-provider isolation, blank retention, removal, disable, one-time migration and restart. Reuse models/secret and private-storage. Add safe HTTP probes to fixed provider URLs with no redirects, bounded bodies, timeout and sanitized errors. No custom destination URL accepts stored keys.

GET /fin-core/api/data-sources returns metadata only. POST body uses {id,action:save|test|enable|disable|remove,credential?}. Validate fields strictly; all mutations share ModelStore.beginChange and the existing research.busy guard. Initialize store in runtime/server.ts before research. Test origin/session rejection, bad inputs and empty installation with isolated temporary state.

## Task 2: Research wiring

Modify runtime/engine/{runner,tools,financial-tools}.ts. Capture DataSourceStore.environment() before starting the Agent. Pass explicit environment into US providers; keep legacy optional SEC parameter only for test/backward code compatibility. Do not serialize environment or credentials into tool results. Generate capability status from actual enabled credentials; EODHD/Alpha Vantage fallback uses only user configured providers. Test injection using fixture requests and absent author environment.

## Task 3: Frontend

Create src/services/data-sources.ts and src/components/settings/DataSourceSettings.tsx (barrel export). Add Data Sources tab in ConnectionDialog and theme-aware styles. Separate saving and testing with one global pending action, per-card feedback, preserved errors and no secret readback. Disable stale-data actions while loading. Remove duplicate SEC editor from ModelSettings and link to the new tab.

## Task 4: Acceptance

Run targeted Vitest store/API/probe and engine integration tests, frontend typecheck/runtime typecheck, lint and full build. Run Playwright with isolated state and synthetic credentials covering configure, test outcome, key cleared, disable, reload, remove, theme and mobile layout. Never inject synthetic credentials into the user's real state. Real SEC/paid market/macro verification remains pending until the user supplies their own values. Restart only the exact managed AURORA process when research is idle; verify the live UI and existing Kimi configuration remain intact. Update setup and release status docs, run source checks. Report only checks actually completed.

## Implementation result (2026-09-27)

Tasks 1–4 implemented serially. 282 runtime tests, the model and data-source browser flows, build/typecheck/lint, and 5 source-checker tests passed. Explicit live supplier verification remains pending user credentials; synthetic fixtures were isolated from the real workstation state. No commit, push or public release was performed.
