# 06 — Security & Authentication

## Deployment Shape Decides Cookie Strategy

Serve the client and the API from **the same origin**: the Vite proxy in development, and a reverse proxy (or Express serving `client/dist`) in production.

| Setup | Cookie | Works? |
|-------|--------|--------|
| Same origin (`app.com` + `app.com/api`) | `SameSite=Lax` | ✅ Simplest. No CORS needed. |
| Subdomains (`app.example.com` + `api.example.com`) | `SameSite=Lax` (same *site*) | ✅ Needs a CORS config |
| Different sites (`x.vercel.app` + `y.onrender.com`) | `SameSite=None; Secure` | ⚠️ A **third-party cookie**: Safari blocks it, and Chrome may. Also needs a CSRF token. **Avoid.** |

## Authentication Flow

1. `POST /auth/login` → `bcrypt.compare` → sign the JWT `{ sub: userId, tv: tokenVersion }` → set the cookie.
2. Cookie options:
```js
res.cookie('token', jwt, {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 3600 * 1000,
  path: '/',
});
```
3. The `auth` middleware verifies the JWT and loads `tokenVersion`. If it doesn't match the token → 401. Sets `req.user = { id }`.
4. The socket handshake runs the same check (see [04](04-REALTIME-SOCKETS.md)).
5. `POST /auth/logout` clears the cookie. With `{ everywhere: true }`, it also does `$inc tokenVersion`, emits `session:revoked` to the `user:<id>` room, and calls `disconnectSockets()` on that room. That revokes every session and closes every open socket right away.
6. Every socket joins `user:<id>` on connect. That room is how the server reaches a user's other tabs and devices: logout everywhere, being removed from a board, being added to one.

**Why `tokenVersion`?** A plain JWT can't be revoked before it expires. One small field restores logout-everywhere and lets you kill a compromised session, and the auth middleware already reads the user record, so it adds no extra request.

Password hashing: `bcryptjs` (cost 12), a pure-JS implementation with the same API as `bcrypt`. It needs no native build, so it installs cleanly on Windows and in Alpine images (ADR-021).

## CSRF

With cookie authentication, the browser attaches the cookie automatically, so CSRF has to be handled:
- `SameSite=Lax` stops cross-site POST/PATCH/DELETE requests from carrying the cookie.
- Also **require `Content-Type: application/json`** on mutations (otherwise respond 415). An HTML form can't send that header, and a cross-origin `fetch` that sets it triggers a CORS preflight, which the server rejects.
- Only if you're forced into `SameSite=None`: add a double-submit CSRF token.

## Authorization

Load the resource once, resolve its board, and check the role in a single place:

```js
// middleware/loadResource.js — attaches req.card / req.list and req.boardId
export const loadCard = async (req, _res, next) => {
  const card = await Card.findById(req.params.id).lean();
  if (!card) throw new ApiError(404, 'NOT_FOUND');
  req.card = card; req.boardId = card.boardId;
  next();
};

// middleware/requireRole.js
const RANK = { viewer: 0, editor: 1, owner: 2 };
export const requireRole = (min) => async (req, _res, next) => {
  const boardId = req.boardId ?? req.params.boardId;
  const board = await Board.findOne(
    { _id: boardId, 'members.userId': req.user.id },
    { members: { $elemMatch: { userId: req.user.id } } },
  ).lean();
  if (!board) throw new ApiError(404, 'NOT_FOUND');             // hides whether the board exists
  const role = board.members[0].role;
  if (RANK[role] < RANK[min]) throw new ApiError(403, 'FORBIDDEN');
  req.boardRole = role;
  next();
};

// routes/cards.js
router.patch('/:id/move', validate(moveSchema), loadCard, requireRole('editor'), cards.move);
```

| Action | owner | editor | viewer |
|--------|:----:|:-----:|:-----:|
| View board, receive live updates | ✅ | ✅ | ✅ |
| Create, edit, move, or delete cards and lists | ✅ | ✅ | ❌ |
| Comment | ✅ | ✅ | ❌ |
| Delete own comment | ✅ | ✅ | — |
| Delete anyone's comment | ✅ | ❌ | ❌ |
| Manage labels, archive and restore | ✅ | ✅ | ❌ |
| Manage members, rename or delete the board | ✅ | ❌ | ❌ |
| Leave the board | ✅ (if not the last owner) | ✅ | ✅ |

Rules:
- **Never trust a `boardId` from the request body.** Always get it from the resource stored in the database.
- Check that `toListId`, `beforeId`, `afterId`, assignee `userId`s, and `labelId`s all belong to the **same board** (otherwise 400 or 404).
- Client-supplied `_id`s on create must be valid ObjectIds. If a duplicate belongs to someone else's document → 409, and never return that document.
- Re-check membership **inside** the mutation transaction for destructive operations (delete list or board), so a just-removed member can't slip a change through.
- The last owner can't be demoted or removed.

## Input Hardening

- Use strict Zod object schemas (`z.strictObject`) from `shared/`. Unknown keys → 400. Parsed values go on `req.valid`, because `req.query` is read-only in Express 5 (ADR-017).
- Run `mongoose.set('sanitizeFilter', true)`, which wraps `$`-operators in user input. This replaces `express-mongo-sanitize`, which **doesn't work with Express 5** (there, `req.query` is a read-only getter). **Side effect:** it also wraps operators in filters the *server* builds, so every server-side query operator (`$in`, `$gt`, `$ne`, …) inside a filter must be wrapped: `{ _id: mongoose.trusted({ $in: ids }) }`. Update operators (`$set`, `$inc`, `$pull`) are not affected.
- Check ObjectId format before querying.
- Cap JSON bodies at 100 kB, and socket payloads with `maxHttpBufferSize`.
- Descriptions: render Markdown with a safe renderer (`react-markdown` without `rehype-raw`). Never pass user text to `dangerouslySetInnerHTML`.

## Platform Hardening

- `helmet()` with a CSP. With same origin, `connect-src 'self'` covers both REST and WebSocket.
- If you need CORS (the subdomain setup), use `cors({ origin: env.CLIENT_ORIGIN, credentials: true })`. Never use `*` together with credentials.
- Rate limiting with `express-rate-limit`, stricter on the auth routes.
- Login: return the generic message "Invalid email or password". Run the bcrypt comparison even when the user doesn't exist, so response timing doesn't reveal which emails are registered.
- Validate config at startup with Zod (`config/env.js`), and fail fast if `JWT_SECRET` is missing or short.
- Logs: include a request ID, and **never** log passwords, cookies, or tokens.
- Run `npm audit --omit=dev` in CI and commit the lockfile.

## Socket Security

- Authenticate in `io.use`, and authorize every `board:join`, re-checking membership after the join to close the race with a concurrent removal (ADR-018).
- Relay `card:editing:*` only to the room the socket actually joined (`socket.data.boardId`), never to a `boardId` the client supplies.
- Throttle short-lived events (5 per second per socket).
- On logout everywhere or member removal, evict the user's sockets through the `user:<id>` room (see [04](04-REALTIME-SOCKETS.md#logout-revocation-membership)).
- An expired JWT doesn't disconnect an open socket. That's acceptable, because sockets carry only reads (events) and every write goes through REST, which re-checks authentication.

## Pre-Deploy Security Checklist

- [ ] HTTPS everywhere, and the `secure` cookie flag is set
- [ ] Same-origin (or same-site) deployment, with no third-party cookies
- [ ] Rate limits on
- [ ] The authorization test matrix passes (see [08](08-TESTING-DEPLOYMENT.md))
- [ ] The error handler hides stack traces in production
- [ ] Atlas: IP allowlist set (not `0.0.0.0/0` unless the host has no static egress IP); the database user has least privilege (`readWrite` on `collabboard-prod` only); separate users for dev and prod
- [ ] `MONGO_URI` lives only in `server/.env` / the platform's secret store, never in git
- [ ] `JWT_SECRET` is at least 64 random characters and isn't in git
