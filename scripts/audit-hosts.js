/**
 * Lists every external host mentioned in the source so you can review where the bot may connect.
 * Usage: npm run audit:hosts
 * Exits with code 1 if it finds hosts belonging to the original authors' infrastructure.
 */
const fs = require("fs");
const path = require("path");

const SKIP = new Set(["node_modules", ".git", "temp", "lang"]);
const BAD = /(raganork_in|rgnk\.site|raganork\.site|raganork-api|raganork-network|raganorkbot|koyeb\.app|onrender\.com|vercel\.app)/i;
const hosts = new Map();

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(js|json|yml|yaml)$/.test(name) && name !== "package-lock.json" && name !== "audit-hosts.js") {
      const text = fs.readFileSync(full, "utf8");
      for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const h = m[1].toLowerCase();
        if (!hosts.has(h)) hosts.set(h, new Set());
        hosts.get(h).add(path.relative(process.cwd(), full));
      }
    }
  }
}
walk(process.cwd());

let bad = 0;
for (const [h, files] of [...hosts.entries()].sort()) {
  const flag = BAD.test(h) ? "  <-- AUTHOR/PAAS HOST" : "";
  if (flag) bad++;
  console.log(h.padEnd(40), [...files].slice(0, 3).join(", ") + (files.size > 3 ? ", ..." : ""), flag);
}
console.log(bad ? `\n${bad} suspicious host(s) found` : "\nNo author-owned hosts found.");
process.exit(bad ? 1 : 0);
