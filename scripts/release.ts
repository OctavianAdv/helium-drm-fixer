#!/usr/bin/env bun
/**
 * Release the fixer: build the Windows and Linux executables and publish them
 * as a GitHub release.
 *
 *   bun run release            release the version in package.json
 *   bun run release patch      bump 1.0.0 -> 1.0.1, then release (also: minor, major, 1.2.3)
 *   bun run release --upload v1.0.0
 *                              only build and upload to the release for an
 *                              existing tag (used by GitHub Actions)
 *
 * Needs a GitHub token: GITHUB_TOKEN, or the login git already saved for github.com.
 */
import { $ } from "bun";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const REPO = "OctavianAdv/helium-drm-fixer";
const API = `https://api.github.com/repos/${REPO}`;
const DIST = "dist";
const ASSETS = [
  "fix-helium-drm-windows-x64.exe",
  "fix-helium-drm-linux-x64",
  "fix-helium-drm-linux-arm64",
];

interface Release {
  id: number;
  html_url: string;
  upload_url: string;
  assets: Array<{ id: number; name: string }>;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function step(message: string) {
  console.log(`\n→ ${message}`);
}

async function getToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const input = Buffer.from("protocol=https\nhost=github.com\n\n");
  const out = await $`git credential fill < ${input}`
    .env({ ...process.env, GIT_TERMINAL_PROMPT: "0" })
    .quiet()
    .nothrow()
    .text();
  const token = out.match(/^password=(.+)$/m)?.[1];
  if (!token) fail("No GitHub token. Set GITHUB_TOKEN or run `git push` once so git saves your login.");
  return token;
}

async function github<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("https://") ? path : `${API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!res.ok) fail(`GitHub API ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [major = 0, minor = 0, patch = 0] = current.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  fail(`Unknown version "${bump}". Use patch, minor, major or a version like 1.2.3.`);
}

/**
 * Release notes from the commits since the previous tag, grouped by feat/fix.
 */
async function releaseNotes(tag: string): Promise<string> {
  const previous = (
    await $`git describe --tags --abbrev=0 ${tag}^`.quiet().nothrow().text()
  ).trim();
  const range = previous ? `${previous}..${tag}` : tag;
  const subjects = (await $`git log --format=%s ${range}`.quiet().text())
    .split("\n")
    .filter((s) => s && !s.startsWith("chore: Release"));

  const groups: Record<string, string[]> = { "✨ Features": [], "🐛 Fixes": [], "🔧 Other": [] };
  for (const subject of subjects) {
    const match = subject.match(/^(\w+)(?:\(.+\))?!?:\s*(.+)$/);
    const type = match?.[1];
    const text = match?.[2] ?? subject;
    const group = type === "feat" ? "✨ Features" : type === "fix" ? "🐛 Fixes" : "🔧 Other";
    groups[group]!.push(`- ${text}`);
  }

  const sections = Object.entries(groups)
    .filter(([, items]) => items.length)
    .map(([title, items]) => `### ${title}\n\n${items.join("\n")}`);

  const raw = `https://raw.githubusercontent.com/${REPO}/main`;
  const download = [
    "### ⬇️ Install",
    "",
    "**Windows** (PowerShell):",
    "",
    "```powershell",
    `irm ${raw}/install.ps1 | iex`,
    "```",
    "",
    "**Linux:**",
    "",
    "```bash",
    `curl -fsSL ${raw}/install.sh | bash`,
    "```",
    "",
    "Or download the file for your system:",
    "",
    "| System | File |",
    "| --- | --- |",
    "| Windows (x64, also runs on ARM) | `fix-helium-drm-windows-x64.exe` |",
    "| Linux (x64) | `fix-helium-drm-linux-x64` |",
    "| Linux (ARM64) | `fix-helium-drm-linux-arm64` |",
    "",
    "On Linux, run `chmod +x` on it first. See the [README](https://github.com/" +
      REPO +
      "#quick-start) for details.",
  ].join("\n");

  const changelog = previous
    ? `\n\n**Full changelog:** https://github.com/${REPO}/compare/${previous}...${tag}`
    : "";

  return [download, ...sections].join("\n\n") + changelog;
}

async function build(): Promise<string[]> {
  step("Running type check and tests");
  await $`bun run typecheck`;
  await $`bun test`;

  step("Building executables");
  await $`bun run build:all`;

  const sums: string[] = [];
  for (const name of ASSETS) {
    const hash = createHash("sha256").update(await Bun.file(join(DIST, name)).bytes()).digest("hex");
    sums.push(`${hash}  ${name}`);
  }
  await Bun.write(join(DIST, "SHA256SUMS.txt"), sums.join("\n") + "\n");
  console.log(sums.join("\n"));

  return [...ASSETS, "SHA256SUMS.txt"].map((name) => join(DIST, name));
}

async function publish(token: string, tag: string, files: string[]): Promise<void> {
  step(`Publishing GitHub release ${tag}`);

  const existing = await fetch(`${API}/releases/tags/${tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  const release: Release = existing.ok
    ? ((await existing.json()) as Release)
    : await github<Release>(token, "/releases", {
        method: "POST",
        body: JSON.stringify({ tag_name: tag, name: tag, body: await releaseNotes(tag) }),
      });

  const uploadBase = release.upload_url.replace(/\{.*\}$/, "");
  for (const file of files) {
    const name = basename(file);
    const old = release.assets.find((a) => a.name === name);
    if (old) await github(token, `/releases/assets/${old.id}`, { method: "DELETE" });

    const data = Bun.file(file);
    console.log(`  uploading ${name} (${(data.size / 1024 / 1024).toFixed(1)} MB)`);
    await github(token, `${uploadBase}?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(data.size) },
      body: data,
    });
  }

  console.log(`\n✅ Released ${tag}: ${release.html_url}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const token = await getToken();

  // CI mode: the tag already exists, just build and upload
  if (args[0] === "--upload") {
    const tag = args[1] ?? fail("Usage: release.ts --upload <tag>");
    await publish(token, tag, await build());
    return;
  }

  step("Checking the repository");
  if ((await $`git status --porcelain`.quiet().text()).trim()) {
    fail("You have uncommitted changes. Commit or stash them first.");
  }
  const branch = (await $`git branch --show-current`.quiet().text()).trim();
  if (branch !== "main") fail(`Releases are made from main (you are on ${branch}).`);
  await $`git pull --ff-only --quiet`;

  const pkg = await Bun.file("package.json").json();
  const version = args[0] ? bumpVersion(pkg.version, args[0]) : pkg.version;
  const tag = `v${version}`;

  if ((await $`git tag --list ${tag}`.quiet().text()).trim()) {
    fail(`${tag} is already released. Use \`bun run release patch\` (or minor/major) for a new version.`);
  }

  const pkgText = await Bun.file("package.json").text();
  if (version !== pkg.version) {
    step(`Bumping version ${pkg.version} → ${version}`);
    await Bun.write(
      "package.json",
      pkgText.replace(`"version": "${pkg.version}"`, `"version": "${version}"`)
    );
  }

  let files: string[];
  try {
    files = await build();
  } catch (error) {
    await Bun.write("package.json", pkgText); // undo the bump
    throw error;
  }

  if (version !== pkg.version) {
    await $`git add package.json`;
    await $`git commit --quiet -m ${`chore: Release ${tag}`}`;
  }

  step(`Tagging ${tag} and pushing`);
  await $`git tag -a ${tag} -m ${tag}`;
  await $`git push --quiet origin main ${tag}`;

  await publish(token, tag, files);
}

await main();
