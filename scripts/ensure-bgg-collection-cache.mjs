import fs from "node:fs";
import path from "node:path";

const target = path.resolve("src/data/bgg-collection-cache.json");
const example = path.resolve("src/data/bgg-collection-cache.example.json");

if (fs.existsSync(target)) {
    console.log("[BGG] Existing collection cache preserved.");
} else {
    if (!fs.existsSync(example)) {
        throw new Error("[BGG] Collection cache template not found.");
    }

    fs.copyFileSync(example, target);
    console.log("[BGG] Collection cache initialized from template.");
}
