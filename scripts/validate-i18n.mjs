#!/usr/bin/env node
/**
 * Validates that messages/fr.json and messages/ar.json have exactly the same
 * keys as messages/en.json. Run: node scripts/validate-i18n.mjs
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const messagesDir = join(root, "messages");

function loadJson(name) {
  const path = join(messagesDir, name);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function allKeyPaths(obj, prefix = "") {
  const keys = [];
  for (const k of Object.keys(obj).sort()) {
    const path = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...allKeyPaths(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const en = loadJson("en.json");
const fr = loadJson("fr.json");
const ar = loadJson("ar.json");

const enKeys = allKeyPaths(en);
const frKeys = allKeyPaths(fr);
const arKeys = allKeyPaths(ar);

const missingInFr = enKeys.filter((k) => !frKeys.includes(k));
const missingInAr = enKeys.filter((k) => !arKeys.includes(k));
const extraInFr = frKeys.filter((k) => !enKeys.includes(k));
const extraInAr = arKeys.filter((k) => !enKeys.includes(k));

let failed = false;

if (missingInFr.length) {
  console.error("Missing in fr.json:", missingInFr.join(", "));
  failed = true;
}
if (missingInAr.length) {
  console.error("Missing in ar.json:", missingInAr.join(", "));
  failed = true;
}
if (extraInFr.length) {
  console.error("Extra keys in fr.json (not in en.json):", extraInFr.join(", "));
  failed = true;
}
if (extraInAr.length) {
  console.error("Extra keys in ar.json (not in en.json):", extraInAr.join(", "));
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`OK: All ${enKeys.length} keys from en.json exist in fr.json and ar.json.`);
