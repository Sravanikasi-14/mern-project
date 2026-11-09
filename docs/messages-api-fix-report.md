# Messages API Failure — Investigation & Fix Report

**Canonical tree:** `D:\HRMS\mern-project`  
**Frontend:** `http://127.0.0.1:5174`  
**Date:** 2026-11-09

## Root cause

There was **no frontend/backend route mismatch inside `D:\HRMS\mern-project`**.

The browser called the correct endpoints against `VITE_API_URL=http://localhost:5000/api`, but **port 5000 was serving `C:\Users\SRAVANI\mern-project\server`**, which does **not** mount conversation (or announcement) routes. Unknown `/api/*` GETs hit that tree’s SPA fallback and returned:

```json
{"code":"NOT_FOUND","message":"API endpoint not found"}
```

`D:\HRMS\mern-project\server\app.js` already registers:

```js
app.use("/api/conversations", conversationRoutes);
app.use("/api/announcements", announcementRoutes);
```

## Failed requests (before fix)

| Method | Full URL | Status | Frontend caller | Expected (D:) | Actual (C: on :5000) |
|---|---|---|---|---|---|
| GET | `http://localhost:5000/api/conversations` | 404 | `useConversationsQuery` → `api.get("/conversations")` | `GET /api/conversations` → `getConversations` | Not mounted → SPA 404 |
| GET | `http://localhost:5000/api/conversations/unread-count` | 404 | `useChatUnreadQuery` → `api.get("/conversations/unread-count")` | `GET /api/conversations/unread-count` → `getUnreadCount` | Not mounted → SPA 404 |

Auth on a known route (`GET /api/auth/me`) still returned **401**, proving the wrong server was up (not a total outage).

## Correct route mappings (D: tree)

| Frontend path (axios base `/api`) | Backend mount |
|---|---|
| `GET /conversations` | `GET /api/conversations` |
| `GET /conversations/unread-count` | `GET /api/conversations/unread-count` |
| `GET/POST /conversations/...` | `server/routes/conversationRoutes.js` (all chat routes) |
| `GET/POST /announcements/...` | `server/routes/announcementRoutes.js` |

All conversation routes use `authenticate` middleware (tenant + session preserved).

## Fix applied

**Operational (required):** Stopped the C: Node process on `:5000` and started:

```bash
cd D:\HRMS\mern-project\server
npm run dev
```

**Code changes:** None required for routes/contracts. Frontend hooks and backend mounts already matched.

After restart, unauthenticated probes returned **401 Authentication required** (route exists) instead of **404 API endpoint not found**.

## Post-fix API status (authenticated HR Admin)

| Endpoint | Status | Result |
|---|---|---|
| `GET /api/conversations` | **200** | 1 conversation loaded |
| `GET /api/conversations/unread-count` | **200** | `unreadCount: 0` |
| `GET /api/conversations/:id/messages` | **200** | messages returned |
| `POST /api/conversations/:id/messages` | **201** | send succeeded |
| `GET /api/conversations/search?q=offer` | **200** | hits returned |
| `GET /api/announcements` | **200** | 1 announcement |

UI no longer shows “API endpoint not found”; conversation list and thread (including sent “API fix verification …” message) render.

## Workflows tested

1. Conversations load — **pass**
2. Unread count loads — **pass**
3. Existing conversations appear — **pass** (1 direct)
4. Direct messages open — **pass**
5. New messages send — **pass** (201)
6. Groups — **no group data** in this tenant (empty list ≠ API failure; groups API authenticated)
7. Announcements load — **pass** (API 200)
8. Search — **pass**
9. Attachments — route registered; not re-uploaded in this pass (covered by `chat_attachments` suite historically)
10. Empty vs failure — distinguished: prior failure was 404; successful empty would be 200 with `[]`

## Auth & tenant isolation

- Unauthenticated access → **401** (not open)
- `conversationRoutes` uses `authenticate`
- `tests/chat_direct.test.js`: **4/4 pass**, including blocks for non-members / other companies

## Build / tests

- `node --test tests/chat_direct.test.js` → **pass 4 / fail 0**
- No Messages UI redesign performed

## Operator note

For Messages (and any chat features), **always run the D: backend** on the API port referenced by `client/.env` (`VITE_API_URL=http://localhost:5000/api`). The C: working tree will continue to return `API endpoint not found` for `/api/conversations*` because those routes are absent there.
