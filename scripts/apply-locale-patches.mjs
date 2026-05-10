#!/usr/bin/env node
/**
 * Merges scripts/locale-patch-{locale}.json, -2, and -3 (each if present)
 * into messages/*.json. Run: node scripts/apply-locale-patches.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(__dirname, "..", "messages");

function deepMerge(target, source) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }
  const base = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  const out = { ...base };
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv !== null && typeof sv === "object" && !Array.isArray(sv)) {
      out[k] = deepMerge(out[k], sv);
    } else {
      out[k] = sv;
    }
  }
  return out;
}

function patchesFor(locale) {
  const names = [
    `locale-patch-${locale}.json`,
    `locale-patch-${locale}-2.json`,
    `locale-patch-${locale}-3.json`,
  ];
  const list = [];
  for (const n of names) {
    const p = join(__dirname, n);
    if (existsSync(p)) list.push(JSON.parse(readFileSync(p, "utf8")));
  }
  return list;
}

for (const locale of ["en", "fr", "ar"]) {
  const patchList = patchesFor(locale);
  if (patchList.length === 0) {
    console.error("No patch files for:", locale);
    process.exit(1);
  }
  const msgPath = join(messagesDir, `${locale}.json`);
  let data = JSON.parse(readFileSync(msgPath, "utf8"));
  for (const patch of patchList) {
    data = deepMerge(data, patch);
  }
  writeFileSync(msgPath, JSON.stringify(data, null, 2) + "\n");
  console.log("Patched", msgPath);
}
