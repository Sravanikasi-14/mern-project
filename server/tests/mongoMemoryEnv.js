/**
 * Test-environment only: keep mongodb-memory-server off the system C: drive.
 *
 * Root cause of Mongod fassert() in this workspace: C: filled to 0 GB free while
 * MongoMemoryServer.create() wrote WiredTiger dbPath under os.tmpdir() (C:\Users\...\Temp).
 * D: has ample free space; redirect TEMP/TMP/TMPDIR and MMS download dir before tests load.
 *
 * Loaded via: node --import ./tests/mongoMemoryEnv.js --test ...
 */
import fs from "node:fs";
import path from "node:path";

const base = "D:\\tmp\\hrms-mongo";
const tmpDir = path.join(base, "tmpdir");
const downloadDir = path.join(base, "binaries");

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(downloadDir, { recursive: true });

// Suites that set instance.dbPath under D:/tmp/hrms-mongo/* require the directory
// to exist before MongoMemoryServer.create(); create common fixture roots here.
for (const name of [
  "ca4c8-remediation",
  "ca4c9-remediation",
  "ca4c10-dashboard",
  "ca-portal-access",
  "ca4b-hr-access-iso",
  "ca4c-hr-enforce-iso",
  "ca4c6-readiness-iso",
  "ca4c6-readiness",
  "ca4c2-remediation",
  "ca4c-hr-enforce-2",
  "ca4b-hr-access",
  "ca3-hr-management",
  "ca2-company-admin-dashboard",
  "ca-org-foundation",
  "portal-identity-link",
  "ca-dept-links",
  "ca-designations",
  "ca-org-batch6",
]) {
  fs.mkdirSync(path.join(base, name), { recursive: true });
}

process.env.TEMP = tmpDir;
process.env.TMP = tmpDir;
process.env.TMPDIR = tmpDir;
process.env.MONGOMS_DOWNLOAD_DIR = downloadDir;
