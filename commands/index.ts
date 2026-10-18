import { compareVersions, getPlatform } from "../lib/paths";
import { findWidevineSources, readWidevine, type WidevineSource } from "../lib/widevine";
import { downloadWidevine, queryGoogle, type Arch } from "../lib/widevine-download";
import {
  findHeliumInstalls,
  heliumAppRoot,
  installIntoHelium,
  installedWidevine,
  removeFromHelium,
  widevineDestination,
  type HeliumInstall,
} from "../lib/helium";
import { verifyWidevine } from "../lib/verify";
import {
  autoFixLog,
  autoLog,
  disableAutoFix,
  enableAutoFix,
  isAutoFixEnabled,
  readAutoState,
  writeAutoState,
} from "../lib/autofix";
import { initLogger, type Logger } from "../lib/logger";
import { closeProcesses, findRunningProcesses, startIndependentProcess } from "../lib/windows";
import { ask, exit } from "../lib/console";
import { t } from "../lib/i18n";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ora from "ora";
import chalk from "chalk";

const execFileAsync = promisify(execFile);

export interface FixHeliumDrmOptions {
  verbose?: boolean;
  dryRun?: boolean;
  check?: boolean;
  chromePath?: string;
  heliumPath?: string;
  forceDownload?: boolean;
  yes?: boolean;
  listSources?: boolean;
  from?: string;
  all?: boolean;
  verify?: boolean;
  status?: boolean;
  undo?: boolean;
  auto?: boolean | string;
  autoRun?: boolean;
  latest?: boolean;
  offline?: boolean;
  reinstall?: boolean;
  /** --status / --list-sources: print JSON (used by the window version) */
  json?: boolean;
}

type Spinner = ReturnType<typeof ora>;

const HELIUM_URL = "https://helium.computer/";

/** Hours between automatic checks with Google for a newer Widevine. */
const GOOGLE_CHECK_HOURS = 6;

/** The window version follows progress through these markers (hidden from its log). */
function step(name: "helium" | "widevine" | "install" | "verify" | "done"): void {
  if (process.env.HELIUM_DRM_FIXER_PROGRESS) console.log(`@@step:${name}`);
}

function describe(source: WidevineSource): string {
  return t("widevineFrom", { version: source.version, source: source.name });
}

function describeHelium(install: HeliumInstall): string {
  const name = install.version ? `Helium ${install.version}` : "Helium";
  return `${name} (${install.arch})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Choosing a Widevine
// ---------------------------------------------------------------------------

/**
 * Pick the Widevine to install for a Helium of this CPU type:
 * --chrome-path, --from <browser>, or the newest copy on this computer.
 * With --latest, Google is asked whether something newer exists.
 * Downloads only when nothing is available locally (never with --offline).
 */
async function chooseWidevine(
  arch: Arch,
  logger: Logger,
  spinner: Spinner,
  options: FixHeliumDrmOptions
): Promise<WidevineSource> {
  if (options.chromePath) {
    const source = await readWidevine(options.chromePath, "custom path", arch);
    if (!source) {
      throw new Error(
        `No usable Widevine in ${options.chromePath} (needs manifest.json and the CDM library for ${arch})`
      );
    }
    return source;
  }

  let best: WidevineSource | undefined;
  if (!options.forceDownload) {
    const sources = await findWidevineSources({ includeApps: Boolean(options.from), arch });
    const candidates = options.from
      ? sources.filter((s) => s.name.toLowerCase().includes(options.from!.toLowerCase()))
      : sources;

    if (options.from && !candidates.length) {
      const available = [...new Set(sources.map((s) => s.name))].join(", ") || "-";
      throw new Error(t("noFrom", { from: options.from, available }));
    }
    best = candidates[0];
  }

  if (best && options.latest && !options.offline && !options.from) {
    try {
      const newest = await queryGoogle(getPlatform(), arch);
      if (compareVersions(newest.version, best.version) > 0) {
        logger.info(`Google has ${newest.version}, newer than local ${best.version}`);
        best = undefined; // download it below
      }
    } catch (error) {
      logger.warn("Couldn't check Google for a newer Widevine", { error });
    }
  }

  if (best) return best;

  if (options.offline) throw new Error(t("offlineNoWidevine"));
  return downloadWidevine(arch, { spinner, logger, forceDownload: options.forceDownload });
}

// ---------------------------------------------------------------------------
// Closing and reopening Helium (Windows locks files; macOS re-signs the app)
// ---------------------------------------------------------------------------

async function closeRunningHelium(
  install: HeliumInstall,
  options: FixHeliumDrmOptions,
  logger: Logger,
  action: string
): Promise<string | null> {
  const platform = getPlatform();
  if (platform === "linux") return null; // nothing is locked; Helium just needs a restart

  let pids: number[];
  let reopen: string;
  if (platform === "darwin") {
    if (!install.appBundle) return null;
    pids = await macHeliumPids(install.appBundle);
    reopen = `mac:${install.appBundle}`;
  } else {
    const prefix = heliumAppRoot(install).toLowerCase() + "\\";
    const running = (await findRunningProcesses("chrome.exe")).filter((p) =>
      p.path.toLowerCase().startsWith(prefix)
    );
    pids = running.map((p) => p.pid);
    const main = running.find((p) => !p.commandLine.includes("--type=")) ?? running[0];
    // Reopen with the same arguments, and bring the tabs back
    reopen = !main
      ? ""
      : main.commandLine.includes("--restore-last-session")
        ? main.commandLine
        : `${main.commandLine} --restore-last-session`;
  }
  if (!pids.length) return null;

  logger.info(`Helium is running (${pids.length} processes)`);
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.log(chalk.yellow(`\n${t("heliumOpenNonTty")}\n`));
      return null;
    }
    const answer = await ask(chalk.yellow(`\n${t("askClose", { action })}`));
    if (/^n/i.test(answer.trim())) {
      console.log(chalk.dim(`\n   ${t("closeWhenReady")}\n`));
      exit(0);
    }
  }

  const spinner = ora(t("closing")).start();
  if (platform === "darwin") await quitMacApp(install.appBundle!);
  else await closeProcesses(pids);
  spinner.succeed(chalk.green(t("closed")));
  return reopen;
}

/** macOS: process IDs of a Helium.app (main process and helpers). */
async function macHeliumPids(app: string): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", `${app}/Contents/`]);
    return stdout.split("\n").map(Number).filter((pid) => pid && pid !== process.pid);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

/** macOS: quit like Cmd+Q (so the session is saved), force only after 10 seconds. */
async function quitMacApp(app: string): Promise<void> {
  await execFileAsync("osascript", ["-e", `tell application "${app.replace(/"/g, '\\"')}" to quit`]).catch(() => {});
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && (await macHeliumPids(app)).length) await Bun.sleep(250);
  for (const pid of await macHeliumPids(app)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

async function reopenHelium(commandLine: string, logger: Logger): Promise<void> {
  if (!commandLine) return;
  logger.info(`Reopening Helium: ${commandLine}`);
  const start = commandLine.startsWith("mac:")
    ? execFileAsync("open", ["-a", commandLine.slice(4), "--args", "--restore-last-session"]).then(() => {})
    : startIndependentProcess(commandLine);
  await start.catch((error) => {
    logger.error("Failed to reopen Helium", { error });
    console.log(chalk.yellow(`\n${t("couldntReopen")}\n`));
  });
}

function explainCopyError(error: unknown): void {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "EBUSY" || (getPlatform() === "win32" && code === "EPERM")) {
    console.log(chalk.yellow(`\n${t("inUse")}`));
    if (getPlatform() === "win32") console.log(chalk.dim(`   ${t("adminHint")}\n`));
  } else if (code === "EACCES" || code === "EPERM") {
    console.log(chalk.yellow(`\n${t("permissionDenied")}\n`));
  } else {
    console.log(chalk.dim(`\n   ${errorMessage(error)}\n`));
  }
}

function heliumNotFound(): never {
  console.log(chalk.red(`\n✖ ${t("heliumNotFound")}`));
  console.log(chalk.yellow(`\n${t("installHeliumFirst", { url: HELIUM_URL })}`));
  console.log(chalk.dim(`   ${t("installedUnusual")}\n`));
  exit(1);
}

async function findInstallsOrExit(options: FixHeliumDrmOptions, logger: Logger): Promise<HeliumInstall[]> {
  const spinner = ora(t("lookingHelium")).start();
  const installs = await findHeliumInstalls({ heliumPath: options.heliumPath, all: options.all });
  spinner.stop();
  if (!installs.length) heliumNotFound();
  for (const install of installs) {
    const note = install.newProfile ? chalk.dim(` ${t("profileWillBeCreated")}`) : "";
    console.log(`${chalk.green("✔")} ${t("foundHelium", { helium: describeHelium(install), dir: chalk.dim(install.dir) })}${note}`);
    logger.info(`Helium: ${JSON.stringify(install)}`);
  }
  return installs;
}

/**
 * macOS: adding files to Helium.app breaks its code signature, so re-sign it
 * (ad hoc). Without this, macOS refuses to load Widevine or start Helium.
 */
async function resignMac(app: string, logger: Logger): Promise<void> {
  const spinner = ora(t("resigning")).start();
  try {
    await execFileAsync("xattr", ["-cr", app]);
    await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", app]);
    spinner.succeed(chalk.green(t("resigned")));
  } catch (error) {
    spinner.fail(chalk.red(t("resignFailed")));
    logger.error("Failed to re-sign Helium.app", { error });
    console.log(chalk.dim(`   ${t("tryCommand", { command: `sudo codesign --force --deep --sign - "${app}"` })}\n`));
  }
}

// ---------------------------------------------------------------------------
// Fix (default command)
// ---------------------------------------------------------------------------

async function fix(options: FixHeliumDrmOptions, logger: Logger): Promise<void> {
  console.log(chalk.bold.cyan(`\n${t("fixing")}\n`));

  step("helium");
  const installs = await findInstallsOrExit(options, logger);
  step("widevine");

  // One Widevine per CPU type (normally just one)
  const chosen = new Map<Arch, WidevineSource>();
  const spinner = ora(t("lookingWidevine")).start();
  try {
    for (const arch of new Set(installs.map((i) => i.arch))) {
      chosen.set(arch, await chooseWidevine(arch, logger, spinner, options));
    }
  } catch (error) {
    spinner.fail(chalk.red(t("widevineFailed")));
    console.log(chalk.dim(`\n   ${errorMessage(error)}\n`));
    exit(1);
  }
  spinner.stop();
  for (const source of new Set(chosen.values())) {
    console.log(`${chalk.green("✔")} ${t("using", { widevine: describe(source) })}`);
  }

  if (options.check) {
    console.log(chalk.bold.green(`\n${t("checkComplete")}\n`));
    return;
  }

  if (options.dryRun) {
    console.log(chalk.bold.yellow(`\n${t("dryRun")}`));
    for (const install of installs) {
      const source = chosen.get(install.arch)!;
      console.log(chalk.dim(`   ${t("wouldCopy", { path: source.path })}`));
      console.log(chalk.dim(`   ${t("wouldCopyTo", { path: widevineDestination(install, source.version) })}`));
    }
    console.log();
    return;
  }

  let failures = 0;
  let unverified = 0;
  step("install");
  for (const install of installs) {
    const source = chosen.get(install.arch)!;
    if (installs.length > 1) console.log(chalk.bold(`\n${describeHelium(install)} - ${install.dir}`));

    const current = await installedWidevine(install);
    const upToDate = current && compareVersions(current.version, source.version) >= 0;

    let reopen: string | null = null;
    if (upToDate && !options.reinstall && !options.forceDownload) {
      console.log(`${chalk.green("✔")} ${t("alreadyInstalled", { version: current!.version })} ${chalk.dim(t("useReinstall"))}`);
    } else {
      reopen = await closeRunningHelium(install, options, logger, t("actionApply"));
      const copy = ora(t("installing", { widevine: describe(source) })).start();
      try {
        await installIntoHelium(install, source);
        copy.succeed(chalk.green(t("installed", { widevine: describe(source) })));
      } catch (error) {
        copy.fail(chalk.red(t("installFailed")));
        logger.error("Failed to install WidevineCdm", { error });
        explainCopyError(error);
        if (reopen) await reopenHelium(reopen, logger);
        failures++;
        continue;
      }
      // macOS: re-sign before Helium is started again (for the check, or by the user)
      if (getPlatform() === "darwin" && install.appBundle) await resignMac(install.appBundle, logger);
    }

    if (options.verify !== false) {
      step("verify");
      const check = ora(t("verifying")).start();
      const result = await verifyWidevine(install);
      if (result.ok) check.succeed(chalk.green(t("verified", { message: result.message })));
      else {
        check.warn(chalk.yellow(t("couldntVerify", { message: result.message })));
        unverified++;
      }
    }

    if (reopen) {
      await reopenHelium(reopen, logger);
      console.log(chalk.dim(`  ${t("reopened")}`));
    }
  }

  if (failures) exit(1);
  if (unverified) {
    console.log(chalk.yellow(`\n${t("unverifiedHint1")}`));
    console.log(chalk.yellow(`   ${t("unverifiedHint2")}\n`));
    exit(2);
  }
  step("done");
  const restart = getPlatform() === "linux" ? ` ${t("restartIfOpen")}` : "";
  console.log(chalk.bold.green(`\n${t("done")}${restart}\n`));
}

// ---------------------------------------------------------------------------
// Other commands
// ---------------------------------------------------------------------------

async function listSources(options: FixHeliumDrmOptions): Promise<void> {
  const spinner = ora({ text: t("searchingSources"), isEnabled: !options.json }).start();
  const sources = await findWidevineSources({ includeApps: true });
  spinner.stop();

  if (options.json) {
    console.log(JSON.stringify(sources));
    return;
  }

  if (!sources.length) {
    console.log(chalk.yellow(`\n${t("noSources")}\n`));
    return;
  }

  console.log(chalk.bold(`\n${t("foundSources", { count: sources.length })}\n`));
  sources.forEach((source, i) => {
    const marker = i === 0 ? chalk.green("→") : " ";
    const layout = source.layout === "flat" ? chalk.dim(` ${t("converted")}`) : "";
    console.log(`${marker} ${chalk.bold(source.name.padEnd(40))} ${source.version.padEnd(14)}${layout}`);
    console.log(chalk.dim(`    ${source.path}`));
  });
  console.log(chalk.dim(`\n${t("useFrom")}\n`));
}

export interface StatusReport {
  version: string;
  platform: string;
  helium: Array<{
    dir: string;
    version: string | null;
    arch: string;
    widevine: string | null;
    /** Newer Widevine available from Google, if any */
    update: string | null;
    drm: "works" | "missing" | "unconfirmed";
    message: string;
  }>;
  sources: number;
  newestLocal: { version: string; name: string } | null;
  newestGoogle: string | null;
  auto: boolean | null;
}

async function collectStatus(options: FixHeliumDrmOptions, version: string): Promise<StatusReport> {
  const installs = await findHeliumInstalls({ heliumPath: options.heliumPath, all: true });
  const [sources, google] = await Promise.all([
    findWidevineSources({ includeApps: true }),
    options.offline ? null : queryGoogle(getPlatform(), installs[0]?.arch ?? "x64").catch(() => null),
  ]);

  const helium: StatusReport["helium"] = [];
  for (const install of installs) {
    const current = await installedWidevine(install);
    const result = current ? await verifyWidevine(install) : null;
    const newest = [google?.version, sources[0]?.version].filter(Boolean).sort((a, b) => compareVersions(b!, a!))[0];
    helium.push({
      dir: install.dir,
      version: install.version,
      arch: install.arch,
      widevine: current?.version ?? null,
      update: current && newest && compareVersions(newest, current.version) > 0 ? newest : null,
      drm: !current ? "missing" : result?.ok ? "works" : "unconfirmed",
      message: result?.message ?? "",
    });
  }

  return {
    version,
    platform: getPlatform(),
    helium,
    sources: sources.length,
    newestLocal: sources[0] ? { version: sources[0].version, name: sources[0].name } : null,
    newestGoogle: google?.version ?? null,
    auto: await isAutoFixEnabled(),
  };
}

async function status(options: FixHeliumDrmOptions, version: string): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(await collectStatus(options, version)));
    return;
  }

  console.log(chalk.bold.cyan(`\n${t("statusTitle", { version })}\n`));
  const spinner = ora(t("lookingHelium")).start();
  const report = await collectStatus(options, version);
  spinner.stop();

  console.log(chalk.bold("Helium"));
  if (!report.helium.length) console.log(`  ${chalk.red("✖")} ${t("notFound")}`);
  for (const h of report.helium) {
    const name = `${h.version ? `Helium ${h.version}` : "Helium"} (${h.arch})`;
    console.log(`  ${chalk.green("✔")} ${name}  ${chalk.dim(h.dir)}`);
    if (!h.widevine) {
      console.log(`      ${chalk.red(t("widevineNotInstalled"))}`);
      continue;
    }
    const verdict = h.drm === "works" ? chalk.green(t("drmWorks")) : chalk.yellow(t("notConfirmed", { message: h.message }));
    console.log(`      ${t("widevineLine", { version: h.widevine, verdict })}`);
    if (h.update) console.log(chalk.yellow(`      ${t("wvUpdateAvailable", { version: h.update })}`));
  }

  console.log(chalk.bold(`\n${t("widevineAvailable")}`));
  console.log(
    report.newestLocal
      ? `  ${t("onThisComputer", { count: report.sources, version: report.newestLocal.version, source: report.newestLocal.name })}`
      : `  ${t("onThisComputerNone")}`
  );
  if (report.newestGoogle) console.log(`  ${t("newestFromGoogle", { version: report.newestGoogle })}`);

  if (report.auto !== null) {
    console.log(chalk.bold(`\n${t("autoTitle")}`));
    console.log(
      report.auto
        ? `  ${chalk.green(t("autoOn"))}  ${chalk.dim(t("logAt", { path: autoFixLog() }))}`
        : `  ${t("autoOff")} ${chalk.dim(t("autoTurnOn"))}`
    );
  }
  console.log();
}

async function undo(options: FixHeliumDrmOptions, logger: Logger): Promise<void> {
  console.log(chalk.bold.cyan(`\n${t("removing")}\n`));
  const installs = await findInstallsOrExit(options, logger);

  for (const install of installs) {
    if (!(await installedWidevine(install))) {
      console.log(`${chalk.green("✔")} ${t("nothingToRemove", { dir: chalk.dim(install.dir) })}`);
      continue;
    }
    const reopen = await closeRunningHelium(install, options, logger, t("actionRemove"));
    try {
      const removed = await removeFromHelium(install);
      if (getPlatform() === "darwin" && install.appBundle) await resignMac(install.appBundle, logger);
      console.log(`${chalk.green("✔")} ${t("removed", { dir: chalk.dim(removed ?? "") })}`);
    } catch (error) {
      console.log(`${chalk.red("✖")} ${t("couldntRemove")}`);
      explainCopyError(error);
    } finally {
      if (reopen) await reopenHelium(reopen, logger);
    }
  }
  console.log(chalk.bold.green(`\n${t("undoDone")}\n`));
}

async function setAuto(state: boolean | string): Promise<void> {
  const off = typeof state === "string" && /^(off|false|no|disable)$/i.test(state);
  if (off) {
    await disableAutoFix();
    console.log(chalk.green(`\n${t("autoOffDone")}\n`));
    return;
  }

  const spinner = ora(t("autoSettingUp")).start();
  try {
    await enableAutoFix();
    spinner.succeed(chalk.green(t("autoIsOn")));
    console.log(chalk.dim(`   ${t("autoExplain")}`));
    console.log(chalk.dim(`   ${t("logAt", { path: autoFixLog() })}`));
    console.log(chalk.dim(`   ${t("autoTurnOff")}\n`));
  } catch (error) {
    spinner.fail(chalk.red(t("autoFailed")));
    console.log(chalk.dim(`\n   ${errorMessage(error)}\n`));
    exit(1);
  }
}

/**
 * Hidden: run every hour by the scheduled task / LaunchAgent / systemd timer.
 * Re-applies the fix after Helium updates and keeps Widevine at the newest
 * version: every few hours it asks Google whether a newer Widevine exists
 * and installs it. Never closes Helium. (Log messages stay in English.)
 */
async function autoRun(logger: Logger): Promise<void> {
  const installs = await findHeliumInstalls({ all: true });
  if (!installs.length) {
    await autoLog("Helium not found - nothing to do");
    return;
  }

  const state = await readAutoState();
  const checkGoogle = Date.now() - (state.lastGoogleCheck ?? 0) > GOOGLE_CHECK_HOURS * 3600_000;

  for (const install of installs) {
    const current = await installedWidevine(install);
    try {
      const source = await chooseWidevine(install.arch, logger, ora({ isEnabled: false }), { latest: checkGoogle });
      if (current && compareVersions(current.version, source.version) >= 0) continue;
      if (getPlatform() === "darwin" && install.appBundle && (await macHeliumPids(install.appBundle)).length) {
        await autoLog(`Helium is running - will fix ${install.dir} after it closes`);
        continue;
      }
      await installIntoHelium(install, source);
      if (getPlatform() === "darwin" && install.appBundle) await resignMac(install.appBundle, logger);
      const what = current ? `Updated Widevine ${current.version} -> ${source.version}` : `Installed Widevine ${source.version}`;
      await autoLog(`${what} from ${source.name} into ${install.dir}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EBUSY" || code === "EPERM") {
        await autoLog(`Helium is using Widevine in ${install.dir} - will update after Helium is closed`);
      } else {
        await autoLog(`Couldn't fix ${install.dir}: ${errorMessage(error)} (will retry)`);
      }
    }
  }

  if (checkGoogle) await writeAutoState({ ...state, lastGoogleCheck: Date.now() });
}

// ---------------------------------------------------------------------------

export async function fixHeliumDrm(options: FixHeliumDrmOptions = {}, version = "0.0.0"): Promise<void> {
  const logger = initLogger(options.verbose || false);

  if (options.autoRun) return autoRun(logger);
  if (options.listSources) return listSources(options);
  if (options.status) return status(options, version);
  if (options.undo) return undo(options, logger);
  if (options.auto !== undefined) return setAuto(options.auto);
  return fix(options, logger);
}
