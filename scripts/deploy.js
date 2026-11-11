#!/usr/bin/env node
// npm run deploy — publish site/ to the Netlify free tier (Task 4).
//
//   npm run deploy -- --site-name my-six-pack   first deploy: creates the free site my-six-pack.netlify.app
//     (add --team <slug> if the CLI says "No teams available"; the slug is shown in Netlify under Team settings)
//   npm run deploy                              later deploys (site id is kept in config/deploy.json)
//   npm run deploy -- --force                   deploy even if site/ hasn't changed
//
// Steps: build (which validates content) → skip if site/ is unchanged since the last deploy → Netlify CLI
// production deploy of site/ → record the site id, URL and content hash in config/deploy.json (commit it).
// Login: run `npx netlify-cli login` once on this computer, or set NETLIFY_AUTH_TOKEN.
// Cost: none. The free plan has a hard monthly limit of 300 credits and is never charged; each production
// deploy uses 15 credits, so this script skips deploys that wouldn't change anything.
"use strict";
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const NETLIFY_CLI = "netlify-cli@27.17.0"; // MIT license; see SOURCES/asset_licenses.md
const root = path.join(__dirname, "..");
const site = path.join(root, "site");
const cfgPath = path.join(root, "config", "deploy.json");
const args = process.argv.slice(2);
const force = args.includes("--force");
const nameIdx = args.indexOf("--site-name");
const siteName = nameIdx >= 0 ? args[nameIdx + 1] : null;
const teamIdx = args.indexOf("--team");
const team = teamIdx >= 0 ? args[teamIdx + 1] : null; // Netlify team slug, only needed when creating the site

const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};

// 1. Build (validates content first and refuses to build if validation fails).
const b = spawnSync(process.execPath, [path.join(__dirname, "build.js")], { stdio: "inherit" });
if (b.status !== 0) process.exit(1);

// 2. Skip if nothing in site/ changed since the last deploy.
function hashDir(dir) {
  const h = crypto.createHash("sha256");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (e.name === ".gitkeep" || e.name === ".DS_Store") return;
      h.update(path.relative(dir, p).split(path.sep).join("/") + "\0");
      h.update(fs.readFileSync(p));
    });
  walk(dir);
  return h.digest("hex");
}
const contentHash = hashDir(site);
if (!force && cfg.siteId && cfg.lastDeployHash === contentHash) {
  console.log(`site/ is unchanged since the last deploy (${cfg.lastDeployAt}); nothing to do.`);
  console.log(`Live at ${cfg.url}  (use --force to deploy anyway; each deploy uses 15 of 300 monthly free credits)`);
  process.exit(0);
}
if (!cfg.siteId && !siteName) {
  console.error("No Netlify site yet. First deploy: npm run deploy -- --site-name <a-name-you-choose>");
  console.error("The site will be at https://<name>.netlify.app (the name must be unused on Netlify).");
  process.exit(1);
}

// 3. Deploy with the free Netlify CLI.
const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
const message = `Deploy ${git.status === 0 ? git.stdout.trim() : ""}`.trim();
const cliArgs = ["--yes", NETLIFY_CLI, "deploy", "--prod", "--no-build", "--dir", site, "--json", "--message", message];
if (cfg.siteId) cliArgs.push("--site", cfg.siteId);
else {
  cliArgs.push("--site-name", siteName);
  if (team) cliArgs.push("--team", team);
}
console.log(`Deploying site/ to Netlify (${cfg.siteId ? cfg.siteName : "new site " + siteName})…`);
let res = null;
// Behind an HTTPS proxy (for example a Claude cloud session, where the proxy supplies the Netlify token),
// the CLI's own requests bypass the proxy and fail as "Project not found". curl honours the proxy, so in
// that case use Netlify's file-digest deploy API directly. Same result, same free plan, no extra tool.
const viaApi = args.includes("--api") || (!!cfg.siteId && !!(process.env.HTTPS_PROXY || process.env.https_proxy) && !args.includes("--cli"));
if (viaApi) {
  if (!cfg.siteId) { console.error("--api needs an existing site (config/deploy.json)."); process.exit(1); }
  const API = "https://api.netlify.com/api/v1";
  const token = process.env.NETLIFY_AUTH_TOKEN || "proxy-injected"; // never printed
  const curl = (extra) => {
    const c = spawnSync("curl", ["-sS", "--fail-with-body", "--retry", "3", "-H", `Authorization: Bearer ${token}`, ...extra],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (c.status !== 0) { console.error(`Netlify API call failed: ${(c.stderr || "").trim()} ${(c.stdout || "").slice(0, 300)}`); process.exit(1); }
    return c.stdout ? JSON.parse(c.stdout) : {};
  };
  const files = {}, bySha = {};
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    if (e.name === ".gitkeep" || e.name === ".DS_Store") return;
    const rel = "/" + path.relative(site, p).split(path.sep).join("/");
    const sha = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
    files[rel] = sha; bySha[sha] = { rel, p };
  });
  walk(site);
  const tmp = path.join(require("os").tmpdir(), `netlify-digest-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ files, title: message }));
  let d;
  try { d = curl(["-X", "POST", "-H", "Content-Type: application/json", "--data-binary", `@${tmp}`, `${API}/sites/${cfg.siteId}/deploys`]); }
  finally { fs.unlinkSync(tmp); }
  const need = d.required || [];
  console.log(`  ${Object.keys(files).length} files, ${need.length} to upload`);
  for (const sha of need) {
    const f = bySha[sha];
    if (!f) continue;
    curl(["-X", "PUT", "-H", "Content-Type: application/octet-stream", "--data-binary", `@${f.p}`,
      `${API}/deploys/${d.id}/files${f.rel.split("/").map(encodeURIComponent).join("/")}`]);
  }
  let state = d.state;
  for (let i = 0; i < 60 && state !== "ready"; i++) {
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},2000)"]);
    const st = curl([`${API}/deploys/${d.id}`]);
    state = st.state;
    if (state === "error") { console.error(`Deploy failed on Netlify: ${st.error_message || "unknown error"}`); process.exit(1); }
  }
  if (state !== "ready") { console.error(`Deploy ${d.id} is still "${state}" after two minutes; check it in Netlify.`); process.exit(1); }
  res = { site_id: cfg.siteId, site_name: cfg.siteName, deploy_id: d.id, url: cfg.url };
} else {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(npx, cliArgs, { cwd: root, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32" });
  const out = (r.stdout || "").trim();
  try { res = JSON.parse(out.slice(out.indexOf("{"))); } catch (e) { /* fall through */ }
  if (r.status !== 0 || !res || !res.site_id) {
    process.stdout.write(out + "\n");
    console.error("Deploy failed. If it's a login problem, run: npx netlify-cli login");
    process.exit(1);
  }
}

// 4. Record where it went.
const url = res.url || (res.site_name ? `https://${res.site_name}.netlify.app` : cfg.url);
const next = {
  host: "netlify",
  siteId: res.site_id,
  siteName: res.site_name || cfg.siteName || siteName,
  url,
  lastDeployId: res.deploy_id,
  lastDeployAt: new Date().toISOString(),
  lastDeployHash: contentHash,
};
fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2) + "\n");
console.log(`Live at ${url}`);
console.log("Recorded in config/deploy.json; commit it so the next deploy goes to the same site.");
