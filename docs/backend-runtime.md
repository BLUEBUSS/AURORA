# Backend runtime

AURORA runs its own frontend and connects through a same-origin proxy to the existing ANLYST Gateway at `127.0.0.1:18789`. No ANLYST source import is needed by the frontend.

## Start and stop

Run `powershell -ExecutionPolicy Bypass -File scripts/start-backend.ps1` from AURORA. The script requires the already built `dist/entry.js`, the compiled fin-core extension, the existing runtime configuration, and the existing backend environment file. Defaults resolve the sibling `ANTLYST` source directory and the existing `LocalApplicationData/Antlyst/dev` state directory. Optional `-SourceRoot` and `-RuntimeRoot` select existing installations.

The script uses `node dist/entry.js gateway run`, binds only loopback, and preserves the current gateway authentication configuration. It does not run the old `start-local.ps1`, `launch-profile.ps1`, workspace synchronization, dependency installation, or a build. It does not rewrite the source configuration or runtime configuration. Missing environment references fail with names only. The pre-existing launcher default for `OPEN_VIKING_URL` is read without executing that launcher. Process environment changes are restored after the child starts.

The backend process is started hidden. AURORA stores its own process record and standard output/error logs under ignored `.runtime/`. Startup validates the listener PID and the unchanged runtime configuration hash. It waits up to 300 seconds by default. If that health window expires while the process is alive, it reports `initializing` and leaves that owned process running; inspect its progress before attempting another start. It only prints bootstrap HTTP status, user presence, and the agent count; the bootstrap token is never printed. Treat raw backend logs as private when inspecting or sharing them.

Run `powershell -ExecutionPolicy Bypass -File scripts/stop-backend.ps1` to stop only the recorded backend. It verifies the command line, creation time, and port owner before stopping. Neither script touches the frontend process.

## State and authentication boundary

The backend still uses its existing state directory. Normal backend operation can write logs, sessions, caches, scheduled-task state, and other runtime data there. Existing background services may resume when the backend starts. This is shared backend state, not a new AURORA tenant or copied research library.

Authentication remains whatever the existing installation specifies. Gateway token authentication and fin-core web-account authentication are separate layers. Bootstrap can return `200` with an anonymous user when the existing fin-core web-account setting is disabled; `401` means the existing login endpoint must be used. AURORA must never treat its demo identity as a real account or forge a user header.

The browser stores the bootstrap gateway token only in the adapter's memory. Authentication cookies remain controlled by the backend. A separate production domain needs HTTPS, the same proxy routes, and an allowed WebSocket Origin. Changing those backend settings is outside these startup scripts.

## Verification

After startup, test bootstrap, protocol 3 WebSocket handshake, a small isolated QA session, streaming, abort acknowledgement, and history reload. An available HTTP endpoint does not establish that every model or financial-data provider is live. Do not include the bootstrap body or credential-bearing environment values in a test report.

### Verified on 2026-09-24

The existing Gateway successfully started on port 18789. Both direct bootstrap and the AURORA port 5174 proxy returned HTTP 200 with the existing anonymous/main identity. The agent-name map was empty; consumers should use the explicit `currentUser.agentId` instead of requiring that map to contain an entry. The runtime configuration SHA-256 was unchanged, and the original ANLYST checkout remained on `main` at `fdf1177` with its original untracked files intact. Running the start script again reused the owned listener without restarting it. Live chat/model verification is a separate acceptance step.

Cold initialization initially exceeded short 45- and 120-second health windows while CPU and memory usage were increasing. The launcher now defaults to 300 seconds and retains an initializing process on timeout. Do not repeatedly restart an active cold initialization.
