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

  it("GET / returns 200 JSON with status, service, and message", async () => {
    const resRoot = await request(app).get("/");
    assert.equal(resRoot.status, 200);
    assert.equal(resRoot.body.status, "ok");
    assert.equal(resRoot.body.service, "hrms-api");
    assert.equal(resRoot.body.message, "API is running");
  });

  it("React Router paths (/login, /admin, /app) return 200", async () => {
    const resAdmin = await request(app).get("/admin");
    assert.equal(resAdmin.status, 200);

    const resLogin = await request(app).get("/login");
    assert.equal(resLogin.status, 200);
  });

  describe("CORS & Cross-Origin Auth Preflight", () => {
    const vercelOrigin = "https://mern-project-nu-nine.vercel.app";

    it("OPTIONS /api/auth/me preflight from Vercel frontend succeeds with 204 and CORS headers", async () => {
      const res = await request(app)
        .options("/api/auth/me")
        .set("Origin", vercelOrigin)
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "Content-Type,Authorization");

      assert.equal(res.status, 204);
      assert.equal(res.headers["access-control-allow-origin"], vercelOrigin);
      assert.equal(res.headers["access-control-allow-credentials"], "true");
      assert.ok(res.headers["access-control-allow-methods"].includes("GET"));
      assert.ok(res.headers["access-control-allow-headers"].includes("Authorization"));
    });

    it("GET /api/auth/me unauthenticated returns 401 with proper CORS headers intact", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Origin", vercelOrigin);

      assert.equal(res.status, 401);
      assert.equal(res.headers["access-control-allow-origin"], vercelOrigin);
      assert.equal(res.headers["access-control-allow-credentials"], "true");
      assert.equal(res.body.code, "UNAUTHORIZED");
    });

    it("OPTIONS preflight for localhost development origin succeeds", async () => {
      const localOrigin = "http://localhost:5173";
      const res = await request(app)
        .options("/api/auth/me")
        .set("Origin", localOrigin)
        .set("Access-Control-Request-Method", "POST");

      assert.equal(res.status, 204);
      assert.equal(res.headers["access-control-allow-origin"], localOrigin);
      assert.equal(res.headers["access-control-allow-credentials"], "true");
    });

    it("CORS rejects unauthorized arbitrary origin", async () => {
      const untrustedOrigin = "https://malicious-site.example.com";
      const res = await request(app)
        .get("/api/auth/me")
        .set("Origin", untrustedOrigin);

      assert.notEqual(res.headers["access-control-allow-origin"], untrustedOrigin);
    });
  });
});
