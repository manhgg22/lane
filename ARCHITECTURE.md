# Architecture Decisions

## Why Next.js instead of Vite?

The harness dashboard needs **server-side rendering** for the audit log and metrics pages — these pages can contain thousands of rows and benefit from streaming HTML. Next.js 15 App Router provides this out of the box with React Server Components. Vite would require a separate SSR setup or ship everything as a client-side SPA, which is fine for a small dashboard but doesn't scale for the audit/metrics views.

If you prefer Vite: the frontend is self-contained in `packages/web/` and only depends on `@harness/sdk`. Swapping Next.js for a Vite SPA means replacing `packages/web/` — the rest of the system is unaffected.

## Why a separate SDK package?

`@harness/sdk` exists so the frontend doesn't import from `@harness/api` directly. Benefits:

1. **Decoupling** — the SDK is a typed HTTP client. The frontend doesn't know about Fastify, database internals, or server-side modules. This means `packages/web/` can be deployed separately or replaced entirely.
2. **Reuse** — the SDK can be used from scripts, CLI tools, or other consumers (e.g. a Slack bot that creates lanes).
3. **React hooks** — `useLanes()`, `useLane()`, `useSSE()`, `useMutation()` live in the SDK so any React frontend can use them without reimplementing fetch/SSE logic.

## Why SSE (Server-Sent Events)?

The dashboard needs real-time updates: when a lane advances, when a lock is acquired, when the scheduler ticks. Options considered:

| Option | Pros | Cons |
|--------|------|------|
| **Polling** | Simple | Latency, unnecessary load |
| **WebSocket** | Bidirectional | Overkill — dashboard is read-only for events |
| **SSE** | Simple, HTTP-native, auto-reconnect | Unidirectional only |

SSE was chosen because the event flow is **server-to-client only**. Actions (advance, block, pass) go through REST POST endpoints — there's no need for bidirectional communication. SSE is simpler than WebSocket, works through proxies, and the browser's `EventSource` API handles reconnection automatically.

## Package dependency graph

```
@harness/types     (leaf — zero dependencies)
    ^
    |
@harness/orchestrator  (depends on types, sql.js)
    ^
    |
@harness/api       (depends on orchestrator, types, fastify)
    
@harness/sdk       (depends on types only — talks to API via HTTP)
    ^
    |
@harness/web       (depends on sdk, types — Next.js frontend)
```

The orchestrator never imports from api, sdk, or web. The api never imports from sdk or web. The sdk never imports from api or orchestrator. This ensures clean layering.

## Why sql.js (WASM SQLite)?

The harness runs on the developer's local machine. Using sql.js means:

- No native binary compilation (works on Windows/Mac/Linux without node-gyp)
- Single-file database (`.harness/harness.db`)
- No external database server to install or manage
- Persistence via `writeFileSync` after every mutation (crash recovery)

Tradeoff: sql.js loads the entire database into memory. This is fine for the harness use case (dozens of lanes, not millions of rows).
