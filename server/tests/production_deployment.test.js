import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../app.js";

describe("Production Deployment & Static Serving", () => {
  const app = createApp();

  it("GET /api/health returns 200 with status ok", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.service, "hrms-api");
    assert.ok(res.body.timestamp);
  });

  it("GET /api/nonexistent-route returns 404 JSON instead of HTML", async () => {
    const res = await request(app).get("/api/nonexistent-route");
    assert.equal(res.status, 404);
    assert.equal(res.body.code, "NOT_FOUND");
  });

  it("GET / and React Router paths (/login, /admin, /app) return 200", async () => {
    const resRoot = await request(app).get("/");
    assert.equal(resRoot.status, 200);

    const resAdmin = await request(app).get("/admin");
    assert.equal(resAdmin.status, 200);

    const resLogin = await request(app).get("/login");
    assert.equal(resLogin.status, 200);
  });
});
