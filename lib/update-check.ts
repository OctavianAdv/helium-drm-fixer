import { compareVersions } from "./paths";

const LATEST_RELEASE = "https://api.github.com/repos/OctavianAdv/helium-drm-fixer/releases/latest";

/**
 * The newest fixer version on GitHub, if it is newer than `current`.
 * Never slows the tool down noticeably: gives up after 2.5 seconds or offline.
 * The one-line installers always run the latest version, so they turn this off.
 */
export async function checkForUpdate(current: string): Promise<string | null> {
  if (process.env.HELIUM_DRM_FIXER_NO_UPDATE_CHECK) return null;
  try {
    const res = await fetch(LATEST_RELEASE, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const latest = String(((await res.json()) as { tag_name?: string }).tag_name ?? "").replace(/^v/, "");
    return latest && compareVersions(latest, current) > 0 ? latest : null;
  } catch {
    return null;
  }
}
