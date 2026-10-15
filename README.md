# MERN Project

MongoDB, Express, React, and Node.js starter with a Vite client and an Express API.

## Structure

```
mern-project/
  client/          React + Vite
  server/          Node + Express
```

## Setup

### Server

```bash
cd server
npm install
```

Copy `.env` values if needed, then start:

```bash
npm run dev
```

API runs at `http://localhost:5000`.

### Client

```bash
cd client
npm install
npm run dev
```

The Vite app runs at `http://localhost:5173` and talks to the API using `VITE_API_URL`.

## Authentication & Onboarding

1. Configure environment files:
   - Server: Ensure `server/.env` contains your `MONGO_URI` and `JWT_SECRET` (see `server/.env.example`).
   - Client: Ensure `client/.env` has `VITE_API_URL=http://localhost:5000/api`.

2. Provision a company and initial HR Admin:

   **Option A: Generate an Onboarding Invitation Link (UI Setup)**
   ```bash
   cd server
   npm run provision:company -- --name "Acme Corp" --code "acme" --email "hr@acme.test" --contact "Jane Doe"
   ```
   Open the printed invitation URL (`http://localhost:5173/onboard?token=...`) in your browser to set the HR Admin password.

   **Option B: Directly provision with a password**
   ```bash
   cd server
   npm run provision:company -- --name "Acme Corp" --code "acme" --email "hr@acme.test" --contact "Jane Doe" --password "YourSecurePassword123!"
   ```

   **Option C: Seed from .env**
   ```bash
   cd server
   npm run seed:auth
   ```

3. Sign in:
   - Navigate to `http://localhost:5173/login`.
   - Enter your **Company code** (e.g. `acme`), **Email**, and **Password**.
   - Public self-registration is disabled for security and tenant isolation.
