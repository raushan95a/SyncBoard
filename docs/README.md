# SyncBoard — Real-Time Collaborative Kanban Workspace

A Trello/Jira-style board where multiple users can drag cards, edit details, and see each other's changes right away, without losing data when edits happen at the same time.

> **Start building:** read [00-REQUIREMENTS](00-REQUIREMENTS.md), then [01-ARCHITECTURE](01-ARCHITECTURE.md), then [11-FEATURE-WORKFLOWS](11-FEATURE-WORKFLOWS.md). Then work through [07-IMPLEMENTATION-ROADMAP](07-IMPLEMENTATION-ROADMAP.md) phase by phase, using 02–06 as reference.

## Documentation Index

| # | File | Purpose |
|---|------|---------|
| 0 | [00-REQUIREMENTS.md](00-REQUIREMENTS.md) | Scope, user stories, MVP vs stretch, non-functional targets |
| 1 | [01-ARCHITECTURE.md](01-ARCHITECTURE.md) | System design, monorepo layout, data flow, consistency model |
| 2 | [02-DATABASE-SCHEMA.md](02-DATABASE-SCHEMA.md) | Mongoose models, indexes, ordering, versioning |
| 3 | [03-API-SPEC.md](03-API-SPEC.md) | REST endpoints, payloads, error codes |
| 4 | [04-REALTIME-SOCKETS.md](04-REALTIME-SOCKETS.md) | Socket.io rooms, event catalog, client event pipeline, scaling |
| 5 | [05-FRONTEND.md](05-FRONTEND.md) | React structure, Redux, optimistic updates, DnD, performance |
| 6 | [06-SECURITY-AUTH.md](06-SECURITY-AUTH.md) | JWT cookies, authorization, CSRF, hardening |
| 7 | [07-IMPLEMENTATION-ROADMAP.md](07-IMPLEMENTATION-ROADMAP.md) | Phased checklist with tests per phase. **Build from this.** |
| 8 | [08-TESTING-DEPLOYMENT.md](08-TESTING-DEPLOYMENT.md) | Test strategy, Docker, CI, deployment |
| 9 | [09-INTERVIEW-GUIDE.md](09-INTERVIEW-GUIDE.md) | Talking points, trade-offs, Q&A |
| 10 | [10-DECISION-LOG.md](10-DECISION-LOG.md) | Architecture Decision Records (why X over Y) |
| 11 | [11-FEATURE-WORKFLOWS.md](11-FEATURE-WORKFLOWS.md) | Every feature traced end to end, plus edge cases and the concurrency matrix. **Use it as a per-feature checklist.** |

## Tech Stack

| Layer | Choice |
|-------|--------|
| Client | React 19 + Vite, Redux Toolkit, React Router, `@hello-pangea/dnd`, `socket.io-client` |
| Server | Node.js 24 (LTS), Express 5, Socket.io 4, Mongoose 9 |
| Shared | `shared/` workspace package: event names, Zod schemas, position helpers |
| Database | MongoDB Atlas (M0 free tier, always a **replica set**, so transactions work), normalized collections. DBs: `collabboard-dev`, `collabboard-prod`. Tests use `mongodb-memory-server` and never touch Atlas. |
| Auth | JWT in an HTTP-only, `SameSite=Lax` cookie (same-origin deploy); passwords hashed with `bcryptjs` |
| Ordering | String fractional indexing (`fractional-indexing`); the server places items relative to the current successor, so keys never collide |
| Scale-out | `@socket.io/redis-adapter` (Phase 8) |
| Testing | Vitest, Supertest, `mongodb-memory-server` (tests only), React Testing Library, Playwright |
| Language | JavaScript (ES modules) with JSDoc for shared payload shapes. No TypeScript (ADR-009). |

## The Six Core Design Decisions

1. **Server-authoritative realtime.** Clients change data only through REST. The server broadcasts an event only *after* the database write succeeds. Clients never emit data-changing events over the socket.
2. **One source of truth for order.** Every list and card has a `position` string. There are no `cardIds`/`listIds` arrays, so a move writes one document.
3. **Optimistic UI with rollback.** The UI updates right away. If the server rejects the change, the UI rolls back and shows a toast.
4. **Explicit compare-and-set versioning.** Text edits send a `version`. If it's stale, the server returns `409 Conflict`. Simple fields such as `completed` and `dueDate` use last-write-wins.
5. **A gap-free revision stream per board.** Every mutation writes its data and increments `board.revision` in **one transaction**, then emits exactly one event, **including to the user who made the change**. Clients apply events in order, buffer events that arrive out of order, and reload the board if one is missing.
6. **Pending ops rebased on confirmed state.** The client shows the last confirmed state with its own pending ops replayed on top. A teammate's change never wipes out an in-flight local change, and a failed change never wipes out a teammate's change.

Every decision is explained in [10-DECISION-LOG.md](10-DECISION-LOG.md).

## Repository Layout

```
syncboard/
├── client/                 # React app            (docs/05)
├── server/                 # Express + Socket.io   (docs/01)
├── shared/                 # event names, zod schemas, position utils
├── docs/                   # you are here
├── docker-compose.yml      # Phase 8: app image + optional redis (MongoDB is Atlas)
├── package.json            # npm workspaces: ["client", "server", "shared"]
├── .github/workflows/ci.yml
└── README.md               # public-facing: GIF demo, architecture diagram, trade-offs
```

## Quick Start (once implemented)

```bash
# prerequisites: Node 24, a MongoDB Atlas cluster (free M0)
git clone <repo> && cd syncboard
cp server/.env.example server/.env   # paste your Atlas mongodb+srv:// URI
npm install                     # installs all workspaces
npm run dev                     # runs server (4000) + client (5180) concurrently
```

Open http://localhost:5180 (a fixed port, so it never clashes with other Vite apps on the default 5173). The Vite dev server proxies `/api` and `/socket.io` to `:4000`, so the browser sees **one origin**. Cookies and CORS work the same way they will in production.

## Environment Variables

**server/.env**
```
PORT=4000
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGO_DB=collabboard-dev          # collabboard-prod in production
JWT_SECRET=<64+ random chars>
JWT_EXPIRES_IN=7d
NODE_ENV=development
REDIS_URL=            # optional; enables multi-instance sockets
```

`MONGO_URI` is only ever read from `server/.env` (git-ignored). It is never hardcoded. The database name comes from `MONGO_DB`, so the same cluster can hold dev and prod data separately.

**client/.env:** none needed in dev, because the proxy handles routing. API calls use the relative paths `/api` and `/socket.io`.
