import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URI;
const backupRoot = process.env.BACKUP_ROOT;
const dbs = ["platform", "company_acme", "company_globex", "company_suspended_test"];

if (!uri || !backupRoot) {
  console.error("MONGO_URI and BACKUP_ROOT required");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const manifest = { createdAt: new Date().toISOString(), databases: {} };

for (const dbName of dbs) {
  const db = client.db(dbName);
  const dbDir = path.join(backupRoot, dbName);
  fs.mkdirSync(dbDir, { recursive: true });
  const cols = (await db.listCollections().toArray()).map((c) => c.name).sort();
  manifest.databases[dbName] = { collections: {} };
  for (const col of cols) {
    const docs = await db.collection(col).find({}).toArray();
    const file = path.join(dbDir, `${col}.json`);
    fs.writeFileSync(file, JSON.stringify(docs, (k, v) => {
      if (v && typeof v === "object" && v._bsontype === "ObjectId") return { $oid: String(v) };
      if (v instanceof Date) return { $date: v.toISOString() };
      if (typeof v === "object" && v !== null && v.constructor?.name === "ObjectId") return { $oid: String(v) };
      if (typeof v === "object" && v !== null && Buffer.isBuffer?.(v)) return { $binary: v.toString("base64") };
      return v;
    }, 2));
    // Also write BSON-friendly via EJSON if available
    const count = docs.length;
    const bytes = fs.statSync(file).size;
    manifest.databases[dbName].collections[col] = { count, bytes, file: `${dbName}/${col}.json` };
    console.log(`DUMPED ${dbName}.${col} count=${count} bytes=${bytes}`);
  }
}

fs.writeFileSync(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("MANIFEST_OK");
await client.close();
