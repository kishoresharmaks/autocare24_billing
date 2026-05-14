"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const releaseDir = path.join(rootDir, "release");
const version = packageJson.version;
const owner = String(process.env.GITHUB_RELEASE_OWNER || "kishoresharmaks").trim();
const repo = String(process.env.GITHUB_RELEASE_REPO || "autocare24_billing").trim();
const token = String(process.env.GH_TOKEN || process.env.GITHUB_RELEASE_TOKEN || "").trim();
const tagName = String(process.env.GITHUB_RELEASE_TAG || `v${version}`).trim();
const dryRun = process.argv.includes("--dry-run");

const fail = (message) => {
  console.error(`Private release publish failed: ${message}`);
  process.exit(1);
};

const readRequiredFile = (filePath) => {
  if (!fs.existsSync(filePath)) fail(`Missing required file: ${filePath}`);
  return fs.readFileSync(filePath);
};

const yamlScalar = (value) => {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/^['"]|['"]$/g, "");
};

const contentTypeFor = (fileName) => {
  if (/\.ya?ml$/i.test(fileName)) return "application/x-yaml; charset=utf-8";
  if (/\.exe$/i.test(fileName)) return "application/vnd.microsoft.portable-executable";
  return "application/octet-stream";
};

const latestPath = path.join(releaseDir, "latest.yml");
const latestText = readRequiredFile(latestPath).toString("utf8");
const remoteInstallerName = yamlScalar((/^\s*path:\s*(.+)\s*$/m.exec(latestText) || [])[1]);
if (!remoteInstallerName) fail("Could not read installer path from release/latest.yml.");

const productName = packageJson.build?.productName || "Autocare24 Billing";
const expectedInstallerPath = path.join(releaseDir, `${productName} Setup ${version}.exe`);
const localInstallerPath = fs.existsSync(expectedInstallerPath)
  ? expectedInstallerPath
  : fs.readdirSync(releaseDir)
      .filter((name) => name.endsWith(".exe") && name.includes(version))
      .map((name) => path.join(releaseDir, name))[0];

if (!localInstallerPath || !fs.existsSync(localInstallerPath)) fail(`Missing installer for version ${version} in ${releaseDir}.`);

const localBlockmapPath = `${localInstallerPath}.blockmap`;
if (!fs.existsSync(localBlockmapPath)) fail(`Missing blockmap file: ${localBlockmapPath}`);

const uploadFiles = [
  { localPath: latestPath, remoteName: "latest.yml" },
  { localPath: localInstallerPath, remoteName: remoteInstallerName },
  { localPath: localBlockmapPath, remoteName: `${remoteInstallerName}.blockmap` }
];

const githubHeaders = (extra = {}) => ({
  "accept": "application/vnd.github+json",
  "authorization": `Bearer ${token}`,
  "user-agent": "autocare24-release-publisher",
  "x-github-api-version": "2022-11-28",
  ...extra
});

async function githubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: githubHeaders(options.headers)
  });
  const text = await response.text();
  if (response.status === 404 && options.allowNotFound) return null;
  if (!response.ok) {
    const hint = response.status === 403 || response.status === 404
      ? " Check that the token has Contents read/write access to the selected private repository."
      : "";
    throw new Error(`${response.status} ${response.statusText}: ${text}${hint}`);
  }
  return text ? JSON.parse(text) : {};
}

async function ensureRelease() {
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tagName)}`;
  const existing = await githubJson(releaseUrl, { allowNotFound: true });
  if (existing) return existing;

  return githubJson(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tag_name: tagName,
      name: `Autocare24 Billing ${version}`,
      draft: false,
      prerelease: false
    })
  });
}

async function deleteExistingAsset(asset) {
  const response = await fetch(asset.url, {
    method: "DELETE",
    headers: githubHeaders()
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Could not delete existing asset ${asset.name}: ${response.status} ${text}`);
  }
}

async function uploadAsset(release, file) {
  const existing = (release.assets || []).find((asset) => asset.name === file.remoteName);
  if (existing) {
    console.log(`Replacing existing asset: ${file.remoteName}`);
    await deleteExistingAsset(existing);
  }

  const body = readRequiredFile(file.localPath);
  const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(file.remoteName)}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: githubHeaders({
      "content-type": contentTypeFor(file.remoteName),
      "content-length": String(body.length)
    }),
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Could not upload ${file.remoteName}: ${response.status} ${response.statusText}: ${text}`);
  }
  console.log(`Uploaded ${file.remoteName}`);
}

async function main() {
  console.log(`Preparing private GitHub release ${owner}/${repo}@${tagName}`);
  for (const file of uploadFiles) {
    const sizeMb = (fs.statSync(file.localPath).size / 1024 / 1024).toFixed(2);
    console.log(`- ${file.remoteName} from ${path.relative(rootDir, file.localPath)} (${sizeMb} MB)`);
  }

  if (dryRun) {
    console.log("Dry run complete. No GitHub release was changed.");
    return;
  }

  if (!token) fail("Set GH_TOKEN or GITHUB_RELEASE_TOKEN before running npm.cmd run release:windows.");
  const release = await ensureRelease();
  for (const file of uploadFiles) await uploadAsset(release, file);
  console.log(`Private release ${tagName} is ready for the cloud update feed.`);
}

main().catch((err) => fail(err.message || String(err)));
