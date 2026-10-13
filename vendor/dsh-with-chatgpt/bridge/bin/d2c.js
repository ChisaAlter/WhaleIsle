#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist", "cli", "index.js");

await import(pathToFileURL(dist).href);
