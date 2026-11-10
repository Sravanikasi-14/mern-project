import http from "http";
import { createApp } from "../app.js";

function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: 5000,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b.slice(0, 400) }));
      }
    );
    r.on("error", (e) => resolve({ error: String(e) }));
    if (data) r.write(data);
    r.end();
  });
}

console.log("POST signature", await req("POST", "/api/settings/company/signature", { method: "TYPE", typedText: "Test" }));
console.log("GET company", await req("GET", "/api/settings/company"));
console.log("POST logo", await req("POST", "/api/settings/company/logo", {}));

const app = createApp();
const out = [];
function walk(stack, prefix = "") {
  for (const layer of stack) {
    if (layer.route) {
      out.push(`${Object.keys(layer.route.methods).join(",").toUpperCase()} ${prefix}${layer.route.path}`);
    } else if (layer.name === "router" && layer.handle?.stack) {
      const s = String(layer.regexp);
      const mm = s.match(/\\\/([\\\w\-]+)/g);
      const mount = mm ? mm.map((x) => x.replace(/\\/g, "")).join("") : "";
      walk(layer.handle.stack, mount);
    }
  }
}
walk(app._router.stack);
console.log("--- mounted ---");
console.log(out.filter((l) => /settings|signature|logo|offer/i.test(l)).join("\n"));
