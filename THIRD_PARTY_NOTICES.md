# Third-party notices

`public/fonts/BodoniModa.ttf` is Bodoni Moda from the official Google Fonts repository, based on Bodoni by Owen Earl / indestructible type. The unmodified font is distributed under SIL Open Font License 1.1; the full license is retained at `public/fonts/OFL-BodoniModa.txt`. Source: https://github.com/google/fonts/tree/main/ofl/bodonimoda . It is served locally with no runtime font request to third parties.

The ANLYST/OpenClaw frontend and gateway protocol were inspected to implement compatible endpoints, handshake fields and session identities. Original OpenClaw MIT notice is retained in `docs/licenses/OpenClaw-MIT.txt`. The backend and its private runtime/configuration are not included.

`runtime/files/` adapts the workarea contracts and organization from ANLYST/OpenClaw's `workspace-files.ts`, with new path validation and bounded local file operations. The same MIT notice is retained. The independent HTTP service does not include the old Gateway/Agent runtime or private configuration; those research components still require a separate migration.

Company symbols `public/logos/nvidia.svg` and `amd.svg` are from Simple Icons 13.0.0 (CC0 distribution): https://github.com/simple-icons/simple-icons/tree/13.0.0 . Trademarks belong to their respective owners; they identify the research subject and do not imply endorsement. Ticker initials provide the fallback for other companies.

Lucide icons are supplied through `lucide-react` (ISC); React (MIT), Vite (MIT), Zustand (MIT), react-markdown (MIT), remark-gfm (MIT), and other package licenses remain in their distributions. No user screenshots or credentials are included in public assets.
