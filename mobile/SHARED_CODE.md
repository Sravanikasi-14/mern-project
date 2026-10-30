# Shared code copied from `client/`

These files were copied into `mobile/` so the mobile app can call the same APIs without a monorepo workspace. Function names and request shapes are unchanged. Extract into a shared package later.

| Mobile path | Original path |
|---|---|
| `src/services/api.js` | `client/src/services/api.js` |
| `src/app/AuthContext.jsx` | `client/src/context/AuthContext.jsx` |
| `src/utils/dateUtils.js` | `client/src/utils/dateUtils.js` |
| `src/utils/companyBrand.js` | `client/src/utils/companyBrand.js` |
| `src/components/StatusBadge.jsx` | `client/src/components/StatusBadge.jsx` |
| `src/components/Icons.jsx` | `client/src/components/Icons.jsx` |

Notes:

- `api.js` additionally reads `VITE_API_BASE_URL` (then `VITE_API_URL`) so the mobile env name matches this folder’s `.env.example`. Interceptors, `withCredentials`, and `/api` paths are identical.
- Auth still stores `hrms_token` in `localStorage` and sends `Authorization: Bearer` plus cookies.
- Location is **not** a copy of `client/src/utils/geolocation.js`. Punch and live tracking go through `src/services/location.js` so Capacitor can replace the web implementation later.
- Ask AI uses the same `POST /chat/stream` contract as `client/src/components/ChatbotWidget.jsx`.
- Notifications use `GET /notifications`, `PATCH /notifications/:id/read`, and `POST /notifications/mark-all-read` as `client/src/components/NotificationPanel.jsx`.
