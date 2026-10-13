import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

const { version } = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const assets = [
  `zemiCC-Setup-${version}-x64.exe`,
  `zemiCC-${version}-win-x64.zip`,
];
const lines = [];
for (const name of assets) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(
    new URL(`../release/${name}`, import.meta.url),
  ))
    hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${name}`);
}
await fs.writeFile(
  new URL("../release/SHA256SUMS.txt", import.meta.url),
  lines.join("\n") + "\n",
);
console.log("SHA-256 checksums written for installer and ZIP.");
