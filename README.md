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
