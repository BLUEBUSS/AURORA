# Standalone chat engine migration

Source: `ANTLYST/packages/fin-core-react/src` at commit
`fdf117722187597b552b55cd59afce92f60e04df`.
The source checkout was read only. `src/engine/LICENSE` preserves its MIT license
and Peter Steinberger's copyright notice. Each extracted TypeScript file links
to this license. `src/engine/migration-manifest.json` records original files,
source SHA-256 hashes, and the hashes of the adapted copies.

## Boundary

The engine contains the original typed operations, reducers, selectors, stable
ID derivation, live/history translators, task and subagent state, and necessary
pure text and session-routing helpers. It imports only other engine files;
tests additionally import Vitest. It does not import React, Zustand, the old
global chat store, the legacy event handler, the source repository, or any
backend configuration. Transport, authentication, event delivery, persistence,
UI state, artifacts, and credential handling remain the caller's responsibility.

The two long source translators were split by responsibility:

- `translators/live.ts`: public dispatch and round/message lifecycle helpers.
- `live.common.ts`, `live.events.ts`, `live.tasks.ts`, `live.tools.ts`, and
  `live.subagent.ts`: text extraction, lifecycle/text, task, tool, and child-run
  translation respectively.
- `translators/history.ts`: history iteration and round boundaries.
- `history.message.ts` and `history.subagent.ts`: transcript extraction and
  child-session replay.

The original reducer already separated task and segment operations and fits
the 700-line file limit. Large test files were divided at top-level suite
boundaries; their assertions were preserved, and unused shared helpers were
removed from each split file.

## Public interface

Import from `src/engine/index.ts`. The barrel exposes:

- `createInitialChatState`, `applyOps`, `chatReducer`, `ChatId`, `ChatSelect`,
  and the original `select*` functions.
- `deriveRoundStartOp`, `deriveRoundCompleteOp`, `deriveMessageEndOp`.
- `liveToOps`, `historyToOps`, `historyToSubagentOps`, `translateTaskUpdateArgs`.
- `eventSessionKey`, `isEventForSession`, `sessionKeysMatch`.
- `ChatState`, `Round`, `ChatOp`, `WsEvent`, `HistoryMessage`, `ChatMessage`,
  `TaskPlan`, `TaskStep`, `ToolCallData`, and segment/card contract types.

`Round` is the engine's round type. It is not the legacy three-slot component
round. The latter exists only in the copied card contract and is not exported
under the same name by the public barrel.

```ts
import {
  applyOps, createInitialChatState, deriveRoundStartOp,
  historyToOps, isEventForSession, liveToOps, ChatSelect,
  type ChatMessage, type HistoryMessage,
} from './engine';

let state = createInitialChatState();
const user: ChatMessage = {
  id: 'user-message-id', role: 'user', content: 'Research question',
  timestamp: Date.now(),
};
state = applyOps(state, [deriveRoundStartOp(state, sessionKey, user)]);

// Do not apply an event to another session's state.
if (isEventForSession(event, payload, sessionKey)) {
  state = applyOps(state, liveToOps({ event, payload }, state));
}

// Rebuild a complete transcript into a fresh state, then resume live delivery.
const restored = applyOps(
  createInitialChatState(),
  historyToOps(messages as HistoryMessage[], sessionKey),
);
const round = restored.rounds[0];
const conclusion = round ? ChatSelect.conclusionText(round) : '';
```

The caller should validate inbound payloads before the example's type boundary.
`ChatMessage` uses `content` / `timestamp`; AURORA's view model uses `text` /
`time`. UI projections should preserve the engine round ID instead of deriving
another round number. Keep one state per session. `Map` and `Set` are used
throughout: do not persist this state with plain JSON serialization. Rebuild
from the authoritative transcript or provide an explicit serializer.

## Behavior preserved

- Planning, execution, and report phases; separate pending/finalized text and
  thinking contributions; no duplicate stored derived conclusion.
- Cumulative text growth, replay/reset deduplication, and independent block
  merging, including reasoning wrappers containing underscores.
- Assistant message boundaries, tool call identity, result-only tool delivery,
  task plans/updates/checkpoints, phase markers, child-run lifecycle and replay.
- Main and child narration/tool grouping; deterministic round/message/segment
  IDs for the source's supported message sequence.
- Terminal operations retain accumulated text, close pending messages, and
  distinguish completed, aborted, and failed live rounds.

## Integration requirements and limits

1. `liveToOps` assumes the caller has routed the event to the correct session
   and active run. Session helpers reject unscoped chat/agent events and accept
   envelope or nested session keys. The caller must also reject stale run IDs
   and protect finished runs from late events. The engine does not own a WS
   listener or connection lifecycle.
2. A normal `chat:delta` requires an `agent:assistant` `message_start` boundary.
   The translator deliberately does not infer a new message from a late delta.
   Terminal `chat:final` closes the current round; it does not consume a final
   text payload. If an older protocol or fixture provides only terminal text,
   the transport adapter needs an explicit, tested recovery path.
3. Apply history synchronously before accepting its subsequent replay events.
   The history translator marks replayed rounds done because the transcript
   does not itself prove an active run. Current run/task status must come from
   the live service; a history load alone is not evidence that execution ended.
4. `provenance_patch` and usage events are not translated by the source live
   dispatcher. The reducer supports provenance/rewrite operations, but an
   adapter must validate and dispatch them. Evidence resolution, annotation
   persistence, file/report extraction, and token accounting are not implemented
   by this migration. The UI must not claim these are connected merely because
   contract types exist.
5. Live timestamps use `Date.now()` as in the source. Replay and live state are
   compared by their semantic content and IDs, not exact wall-clock timestamps.
   Missing user transcript IDs retain the source's generated placeholder IDs;
   these placeholders are unsuitable as durable server identities.
6. Legacy history counts hidden system-injected user messages in its round
   numbering, while omitting them from visible rounds. The migration fixes
   collision after restored index gaps (below). A trailing hidden message can
   still change the legacy index assigned on a later full replay. Do not use a
   client-derived round ID as an external authorization or permanent database
   key; durable correlation needs the backend's message/run identity.

## Intentional correction

The source `nextRoundIndexFor` counted visible rounds. A transcript containing
hidden task-steering/subagent-announcement messages can restore indices such as
`[0, 2]`. A subsequent send then chose `2` again and reused the prior round ID.
The new integration test reproduced this: starting a third question left only
two rounds. AURORA now chooses `max(existing round.index) + 1` for that session.
The existing source numbering is preserved, and restored content is no longer
overwritten by a follow-up question.

## Validation

The migration carries 244 original pure regression assertions across 16 files:
ID stability, typed operations, reducer classifications and lifecycle, selectors,
normalizers, main/child history, live task/tool events, replay idempotency,
child live/history parity, and session event routing. Legacy store/parity tests
that require the old application store or history renderer were not copied.

Three additional integration assertions cover main-round live/history equality
with thinking and tools, continuation after restored index gaps, and output
preservation on abort/error. Run:

```sh
pnpm typecheck
pnpm exec vitest run src/engine --maxWorkers=2
pnpm exec oxlint src/engine
```

These are local engine checks. They do not prove live backend credentials,
transport replay ordering, source resolution, or rendered UI acceptance.

Verified on 2026-09-24: typecheck passed; 17 test files / 247 assertions passed;
engine lint produced no warnings. The import-boundary check found no external
runtime dependencies or unresolved imports, all 39 manifest hashes matched,
and the largest extracted TypeScript file was 675 lines.
