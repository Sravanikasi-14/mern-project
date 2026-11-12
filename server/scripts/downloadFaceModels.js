/**
 * Downloads @vladmandic/face-api model weights into server/assets/face-models.
 * Usage: npm run face:models
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.FACE_MODELS_DIR || path.join(__dirname, "../assets/face-models");

const BASE =
  "https://raw.githubusercontent.com/vladmandic/face-api/master/model";

const FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model.bin",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(err);
      });
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of FILES) {
    const dest = path.join(outDir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`skip ${name}`);
      continue;
    }
    console.log(`download ${name}`);
    await download(`${BASE}/${name}`, dest);
  }
  console.log(`Face models ready in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
