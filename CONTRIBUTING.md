# Contributing

AURORA is preparing an independent open-source release. The frontend runs on its own; the distributable backend and first-run model setup are still being prepared. Do not assume a passing frontend check proves the complete product is ready to publish.

Use Node.js 24 and pnpm 11.19.0 for the currently validated development toolchain:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Choose the local demo in settings if no compatible backend is available. Do not copy another person's runtime configuration, API keys or research data. The existing PowerShell backend launcher is a developer compatibility tool, not the independent release installer.

Before requesting review:

```sh
pnpm check:source
pnpm test:release
pnpm typecheck
pnpm lint
pnpm test
pnpm test:runtime
pnpm build
pnpm audit --audit-level=moderate
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser suite uses isolated contexts and synthetic demo/protocol fixtures. Do not run destructive checks against existing research. Add regression coverage for a reported behavioral defect and state separately whether a real backend/model was used.

Keep changes scoped and source files below 700 lines. Include the problem, resulting behavior and relevant verification in pull requests. Preserve third-party notices. Never include model keys, authentication profiles, personal environment files, transcripts, screenshots containing user data or runtime logs.

`check:source` is a limited, non-secret-printing hygiene check over tracked and non-ignored candidate files. It is not a full secret scanner and does not scan Git history or release binaries. Final publication requires the separate release review in `docs/release-checklist.md`.
