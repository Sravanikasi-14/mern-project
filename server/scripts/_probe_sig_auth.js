import http from "http";
import fs from "fs";

const token = process.argv[2];
if (!token) {
  console.error("Usage: node _probe_sig_auth.js <jwt>");
  process.exit(1);
}

function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const r = http.request(
      { hostname: "127.0.0.1", port: 5000, path, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"],
            body: buf.toString("utf8").slice(0, 500),
          });
        });
      }
    );
    r.on("error", (e) => resolve({ error: String(e) }));
    if (data) r.write(data);
    r.end();
  });
}

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

console.log("GET company", await req("GET", "/api/settings/company"));
console.log("POST TYPE", await req("POST", "/api/settings/company/signature", { method: "TYPE", typedText: "Acme Signatory" }));
console.log("POST DRAW", await req("POST", "/api/settings/company/signature", { method: "DRAW", fileData: png }));
console.log("GET signature", await req("GET", "/api/settings/company/signature"));
console.log("GET company after", await req("GET", "/api/settings/company"));
