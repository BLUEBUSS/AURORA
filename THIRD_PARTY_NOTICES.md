# Third-party notices

The independent research implementation uses `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai` (MIT), the same core family as the original backend, plus adapted fin-core task storage, tools, navigation and research method documents. Source provenance is in `runtime/engine/migration-manifest.json`; the new transport/persistence adapter does not copy the complete OpenClaw Gateway.

`runtime/financial/` is derived from BLUEBUSS/financial-agent-tools at `6ec79fd0616ac755df7a0b54d0a026b074c2a477`. Its LICENSE and NOTICE.md are retained there, with source/adaptation hashes in its migration manifest. No personal credentials or research data are included. Licenses for ws, TypeBox, undici and other packages remain in their distributions.

The notes below also retain the earlier frontend-only and runtime-foundation milestones; references to components awaiting migration describe those earlier milestones.

`public/fonts/BodoniModa.ttf` is Bodoni Moda from the official Google Fonts repository, based on Bodoni by Owen Earl / indestructible type. The unmodified font is distributed under SIL Open Font License 1.1; the full license is retained at `public/fonts/OFL-BodoniModa.txt`. Source: https://github.com/google/fonts/tree/main/ofl/bodonimoda . It is served locally with no runtime font request to third parties.

The ANLYST/OpenClaw frontend and gateway protocol were inspected to implement compatible endpoints, handshake fields and session identities. Original OpenClaw MIT notice is retained in `docs/licenses/OpenClaw-MIT.txt`. The original full Gateway and all personal runtime/configuration are excluded.

`runtime/files/` adapts the workarea contracts and organization from ANLYST/OpenClaw's `workspace-files.ts`, with new path validation and bounded local file operations. The same MIT notice is retained. The independent HTTP service does not include the old Gateway/Agent runtime or private configuration; the independent research runtime is described above.

Company symbols `public/logos/nvidia.svg`, `amd.svg` and `sandisk.svg` are from Simple Icons 13.0.0 (CC0 distribution): https://github.com/simple-icons/simple-icons/tree/13.0.0 . Trademarks belong to their respective owners; they identify the research subject and do not imply endorsement. Ticker initials provide the fallback for other companies.

Lucide icons are supplied through `lucide-react` (ISC); React (MIT), Vite (MIT), Zustand (MIT), react-markdown (MIT), remark-gfm (MIT), and other package licenses remain in their distributions. No user screenshots or credentials are included in public assets.
