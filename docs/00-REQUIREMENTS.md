# 00 — Requirements & Scope

Pin down the scope before writing code. Interviewers value a project that does a **small set of things very well** more than a long feature list.

## Problem Statement

Teams need a shared board where everyone sees the same state in real time. Concurrent drags and edits must never silently lose data or leave users with different views of the board.

## Personas

- **Owner:** creates boards and manages members and roles.
- **Editor:** creates, edits, moves, and comments on cards and lists.
- **Viewer:** has read-only access and sees live updates.

## User Stories (MVP)

| ID | As a… | I want to… | Acceptance criteria |
|----|-------|-----------|---------------------|
| U1 | visitor | register / log in | Session survives a refresh. A wrong password shows a generic error. |
| U2 | user | create a board and see my boards | The creator becomes the owner. The list shows only boards I belong to. |
| U3 | editor | add, rename, reorder, and delete lists | Order persists after a refresh. |
| U4 | editor | add cards and drag them within and between lists | The drop responds in under 100 ms. Order persists. A failed request snaps the card back and shows a toast. |
| U5 | editor | open a card and edit its title, description, due date, labels, and assignees | Saves happen automatically. A concurrent text edit shows a conflict banner instead of overwriting. |
| U6 | member | see other users' changes live | Another user's move appears in under 150 ms on the same LAN. |
| U7 | member | see who is online and who is editing a card | Avatar bar, plus an "Alice is editing…" badge. |
| U8 | owner | invite by email, change roles, and remove members | A removed user loses access right away, including live updates. |
| U9 | editor | comment on cards | Comments appear live and are paginated. |
| U10 | member | lose connection and come back | A "Reconnecting…" banner appears, and the board resyncs automatically. |
| U11 | editor | manage board labels (name and color) and tag cards | Renaming a label updates every card. Deleting one removes it from every card. |
| U12 | editor | archive lists and cards, then restore or permanently delete them | An Archive panel lists archived items. A restored item reappears at the end. |
| U13 | member | filter the board by text, member, label, or due date | Instant (client-side). The filter is kept in the URL. Dragging still works while filtered. |
| U14 | member | see who deleted something, and be moved out of a board that was deleted or I was removed from | Clear full-page message, with no error screen or stale UI. |

Every story is traced end to end, with its edge cases, in [11-FEATURE-WORKFLOWS](11-FEATURE-WORKFLOWS.md).

## Explicitly Out of Scope (MVP)

- Offline editing with a mutation queue
- Character-level collaborative text editing (CRDT/OT). Whole-field versioning is enough here.
- Attachments, notifications/email, multiple workspaces or orgs
- Password reset and email verification (they need an email provider)
- Email invitations for people who aren't registered (only existing users can be invited)
- Comment editing, @mentions, activity feed (the feed is optional in Phase 7)
- Moving cards between boards, card templates, checklists
- Search across boards (search runs within the open board)
- Mobile app

These are listed as stretch goals in [07](07-IMPLEMENTATION-ROADMAP.md). Being able to explain *why* you left them out is itself a strong interview answer (see [09](09-INTERVIEW-GUIDE.md)).

## Non-Functional Requirements

| Concern | Target | How it's verified |
|---------|--------|-------------------|
| Perceived drag latency | < 100 ms (optimistic) | Manual check + React Profiler |
| Remote propagation | p95 < 150 ms | Artillery load test |
| Board load (500 cards) | < 300 ms server time | Seed script + timing log |
| Concurrent users per board | 50 | Artillery |
| Board size | up to 2,000 cards | Seed script |
| Re-renders on one card move | moved card + source/destination columns only | Render-count test |
| Security | no access across boards | Authorization integration tests |
| Recovery | server restart → clients resync with no user action | Playwright test |

## Glossary

| Term | Meaning |
|------|---------|
| **position** | Fractional-index string that sets the order within a parent (board or list) |
| **revision** | Board-level counter. It goes up by exactly 1 per mutation, and each increase emits one event. |
| **version** | Per-card counter used for compare-and-set on text edits |
| **op** | A pending optimistic operation on the client, replayed on top of the confirmed state until the server confirms or rejects it |
| **base** | The last server-confirmed state of an entity that has pending ops |
| **mutateBoard** | Server helper that runs a data write and `$inc revision` in one transaction |
| **clientMutationId** | Random ID the client attaches to a mutation so it can recognize the echo of its own change |
| **optimistic update** | Applying a change locally before the server confirms it |
