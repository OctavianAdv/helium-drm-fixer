/**
 * Publish packaging/winget to microsoft/winget-pkgs through a fork:
 *
 *  - package already in winget  -> new branch + "New version" pull request
 *  - first submission still open -> move that pull request to this version
 *  - neither                     -> "New package" pull request
 *
 * Everything goes through the GitHub API with the user's own token.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const UPSTREAM = "microsoft/winget-pkgs";
const USER = "OctavianAdv";
const ID = "OctavianAdv.HeliumDrmFixer";
const PACKAGE_DIR = "manifests/o/OctavianAdv/HeliumDrmFixer";

type Gh = (path: string, init?: RequestInit, ok?: number[]) => Promise<any>;

function client(token: string): Gh {
  return async (path, init = {}, ok = []) => {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (!res.ok && !ok.includes(res.status)) {
      throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  };
}

async function ensureFork(gh: Gh): Promise<void> {
  await gh(`/repos/${UPSTREAM}/forks`, { method: "POST", body: JSON.stringify({ default_branch_only: true }) }, [202]);
  for (let i = 0; i < 60; i++) {
    if ((await gh(`/repos/${USER}/winget-pkgs`, {}, [404]))?.id) return;
    await Bun.sleep(5000);
  }
  throw new Error("Fork of winget-pkgs did not become ready");
}

async function createBranch(gh: Gh, branch: string): Promise<void> {
  const master = await gh(`/repos/${UPSTREAM}/git/ref/heads/master`);
  for (let i = 0; i < 20; i++) {
    const res = await gh(
      `/repos/${USER}/winget-pkgs/git/refs`,
      { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: master.object.sha }) },
      [422, 404]
    );
    if (res?.ref || res?.message?.includes("already exists")) return;
    await Bun.sleep(5000); // a fresh fork may still be copying objects
  }
  throw new Error(`Could not create branch ${branch}`);
}

async function listFiles(gh: Gh, path: string, ref: string): Promise<Array<{ path: string; sha: string }>> {
  const items = await gh(`/repos/${USER}/winget-pkgs/contents/${path}?ref=${encodeURIComponent(ref)}`, {}, [404]);
  if (!Array.isArray(items)) return [];
  const files: Array<{ path: string; sha: string }> = [];
  for (const item of items) {
    if (item.type === "dir") files.push(...(await listFiles(gh, item.path, ref)));
    else files.push({ path: item.path, sha: item.sha });
  }
  return files;
}

async function putFiles(gh: Gh, branch: string, folder: string, wingetDir: string, message: string): Promise<void> {
  for (const name of (await readdir(wingetDir)).sort()) {
    const path = `${folder}/${name}`;
    const existing = await gh(`/repos/${USER}/winget-pkgs/contents/${path}?ref=${encodeURIComponent(branch)}`, {}, [404]);
    await gh(`/repos/${USER}/winget-pkgs/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(await Bun.file(join(wingetDir, name)).text()).toString("base64"),
        branch,
        ...(existing?.sha ? { sha: existing.sha } : {}),
      }),
    });
  }
}

function prBody(version: string, isNew: boolean): string {
  return [
    isNew ? "### New package: Helium DRM Fixer" : `### New version: Helium DRM Fixer ${version}`,
    "",
    "A command-line tool that enables Widevine DRM in the [Helium browser](https://helium.computer/). It finds Widevine in other installed browsers and apps (or downloads it from Google's component update server), installs it into Helium, and verifies inside Helium that DRM works.",
    "",
    `- Homepage: https://github.com/${USER}/helium-drm-fixer`,
    `- Release notes: https://github.com/${USER}/helium-drm-fixer/releases/tag/v${version}`,
    "- License: MIT",
    "- Installer type: portable (single self-contained x64 executable)",
    "- Command: `fix-helium-drm`",
    "",
    "- [x] Have you checked that there aren't other open [pull requests](https://github.com/microsoft/winget-pkgs/pulls) for the same manifest update/change?",
    "- [x] This PR only modifies one (1) manifest",
    "- [x] Have you [validated](https://github.com/microsoft/winget-pkgs/blob/master/doc/Authoring.md#validation) your manifest locally with `winget validate --manifest <path>`?",
    "- [x] Does your manifest conform to the [1.6 schema](https://github.com/microsoft/winget-pkgs/tree/master/doc/manifest/schema/1.6.0)?",
    "",
    "I am the author of this tool.",
  ].join("\n");
}

/**
 * Submit `version` (already written to packaging/winget). Returns the pull request URL.
 */
export async function publishToWinget(token: string, version: string, wingetDir: string): Promise<string> {
  const gh = client(token);
  await ensureFork(gh);

  const inWinget = Boolean((await gh(`/repos/${UPSTREAM}/contents/${PACKAGE_DIR}`, {}, [404]))?.length);
  const ours = ((await gh(`/repos/${UPSTREAM}/pulls?state=open&per_page=100&head=${USER}:`)) as any[])
    .filter((pr) => pr.user?.login === USER && pr.title.includes(ID));

  // Same version already submitted
  const sameVersion = ours.find((pr) => pr.title.endsWith(`version ${version}`));
  if (sameVersion) return sameVersion.html_url;

  const folder = `${PACKAGE_DIR}/${version}`;

  if (!inWinget && ours[0]) {
    // First submission still under review: move it to this version
    const pr = ours[0];
    const branch = pr.head.ref as string;
    for (const file of await listFiles(gh, PACKAGE_DIR, branch)) {
      if (file.path.startsWith(`${folder}/`)) continue;
      await gh(`/repos/${USER}/winget-pkgs/contents/${file.path}`, {
        method: "DELETE",
        body: JSON.stringify({ message: `Replace with version ${version}`, sha: file.sha, branch }),
      });
    }
    await putFiles(gh, branch, folder, wingetDir, `New package: ${ID} version ${version}`);
    await gh(`/repos/${UPSTREAM}/pulls/${pr.number}`, {
      method: "PATCH",
      body: JSON.stringify({ title: `New package: ${ID} version ${version}`, body: prBody(version, true) }),
    });
    return pr.html_url;
  }

  const kind = inWinget ? "New version" : "New package";
  const branch = `${ID}-${version}`;
  await createBranch(gh, branch);
  await putFiles(gh, branch, folder, wingetDir, `${kind}: ${ID} version ${version}`);
  const pr = await gh(`/repos/${UPSTREAM}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `${kind}: ${ID} version ${version}`,
      head: `${USER}:${branch}`,
      base: "master",
      maintainer_can_modify: true,
      body: prBody(version, !inWinget),
    }),
  });
  return pr.html_url;
}
