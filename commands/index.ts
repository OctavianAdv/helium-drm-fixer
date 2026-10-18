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
} from "../lib/autofix";
import { initLogger, type Logger } from "../lib/logger";
import { closeProcesses, findRunningProcesses, startIndependentProcess } from "../lib/windows";
import { ask, exit } from "../lib/console";
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
}

type Spinner = ReturnType<typeof ora>;

function describe(source: WidevineSource): string {
  return `Widevine ${source.version} from ${source.name}`;
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
      const available = [...new Set(sources.map((s) => s.name))].join(", ") || "none";
      throw new Error(`No Widevine found from "${options.from}". Available: ${available}`);
    }
    best = candidates[0];
  }

  if (best && options.latest && !options.offline && !options.from) {
    spinner.text = "Checking Google for a newer Widevine...";
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

  if (options.offline) {
    throw new Error("No Widevine on this computer, and --offline doesn't allow downloading one");
  }
  spinner.text = "No Widevine on this computer - downloading it...";
  return downloadWidevine(arch, { spinner, logger, forceDownload: options.forceDownload });
}

// ---------------------------------------------------------------------------
// Closing and reopening Helium (Windows locks files in use)
// ---------------------------------------------------------------------------

async function closeRunningHelium(
  install: HeliumInstall,
  options: FixHeliumDrmOptions,
  logger: Logger,
  action: string
): Promise<string | null> {
  if (getPlatform() !== "win32") return null;

  const prefix = heliumAppRoot(install).toLowerCase() + "\\";
  const running = (await findRunningProcesses("chrome.exe")).filter((p) =>
    p.path.toLowerCase().startsWith(prefix)
  );
  if (!running.length) return null;

  logger.info(`Helium is running (${running.length} processes)`);
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.log(chalk.yellow("\n⚠️  Helium is open. If this fails, close Helium or run with --yes.\n"));
      return null;
    }
    const answer = await ask(
      chalk.yellow(`\nHelium is open. Close it now to ${action}? It will reopen afterwards. [Y/n] `)
    );
    if (/^n/i.test(answer.trim())) {
      console.log(chalk.dim("\n   Close Helium and run this again when you're ready.\n"));
      exit(0);
    }
  }

  const spinner = ora("Closing Helium...").start();
  const main = running.find((p) => !p.commandLine.includes("--type=")) ?? running[0]!;
  await closeProcesses(running.map((p) => p.pid));
  spinner.succeed(chalk.green("Closed Helium"));

  // Reopen with the same arguments, and bring the tabs back
  return main.commandLine.includes("--restore-last-session")
    ? main.commandLine
    : `${main.commandLine} --restore-last-session`;
}

async function reopenHelium(commandLine: string, logger: Logger): Promise<void> {
  logger.info(`Reopening Helium: ${commandLine}`);
  await startIndependentProcess(commandLine).catch((error) => {
    logger.error("Failed to reopen Helium", { error });
    console.log(chalk.yellow("\n⚠️  Couldn't reopen Helium - please start it yourself.\n"));
  });
}

function explainCopyError(error: unknown): void {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "EBUSY" || (getPlatform() === "win32" && code === "EPERM")) {
    console.log(chalk.yellow("\n⚠️  WidevineCdm is in use. Close Helium completely and try again."));
    if (getPlatform() === "win32") {
      console.log(
        chalk.dim("   If Helium is installed for all users (Program Files), run this from an Administrator terminal.\n")
      );
    }
  } else if (code === "EACCES" || code === "EPERM") {
    console.log(chalk.yellow("\n⚠️  Permission denied. Run again with sudo, or check folder permissions.\n"));
  } else {
    console.log(chalk.dim(`\n   ${errorMessage(error)}\n`));
  }
}

function heliumNotFound(): never {
  console.log(chalk.red("\n✖ Helium browser not found"));
  console.log(chalk.yellow("\n⚠️  Install Helium first: https://helium.is/"));
  console.log(chalk.dim("   Installed somewhere unusual? Open Helium and run this again, or pass --helium-path.\n"));
  exit(1);
}

async function findInstallsOrExit(options: FixHeliumDrmOptions, logger: Logger): Promise<HeliumInstall[]> {
  const spinner = ora("Looking for Helium...").start();
  const installs = await findHeliumInstalls({ heliumPath: options.heliumPath, all: options.all });
  if (!installs.length) {
    spinner.stop();
    heliumNotFound();
  }
  spinner.stop();
  for (const install of installs) {
    const note = install.newProfile ? chalk.dim(" (profile will be created)") : "";
    console.log(`${chalk.green("✔")} Found ${describeHelium(install)}: ${chalk.dim(install.dir)}${note}`);
    logger.info(`Helium: ${JSON.stringify(install)}`);
  }
  return installs;
}

// ---------------------------------------------------------------------------
// Fix (default command)
// ---------------------------------------------------------------------------

async function fix(options: FixHeliumDrmOptions, logger: Logger): Promise<void> {
  console.log(chalk.bold.cyan("\n🔧 Fixing Helium DRM...\n"));

  const installs = await findInstallsOrExit(options, logger);

  // One Widevine per CPU type (normally just one)
  const chosen = new Map<Arch, WidevineSource>();
  const spinner = ora("Looking for Widevine in your browsers and apps...").start();
  try {
    for (const arch of new Set(installs.map((i) => i.arch))) {
      chosen.set(arch, await chooseWidevine(arch, logger, spinner, options));
    }
  } catch (error) {
    spinner.fail(chalk.red("Couldn't find or download Widevine"));
    console.log(chalk.dim(`\n   ${errorMessage(error)}\n`));
    exit(1);
  }
  spinner.stop();
  for (const source of new Set(chosen.values())) {
    console.log(`${chalk.green("✔")} Using ${describe(source)}`);
  }

  if (options.check) {
    console.log(chalk.bold.green("\n✅ Check complete. The fix can be applied.\n"));
    return;
  }

  if (options.dryRun) {
    console.log(chalk.bold.yellow("\n🔍 Dry run - no changes made."));
    for (const install of installs) {
      const source = chosen.get(install.arch)!;
      console.log(chalk.dim(`   Would copy: ${source.path}`));
      console.log(chalk.dim(`   To:         ${widevineDestination(install, source.version)}`));
    }
    console.log();
    return;
  }

  let failures = 0;
  let unverified = 0;
  for (const install of installs) {
    const source = chosen.get(install.arch)!;
    if (installs.length > 1) console.log(chalk.bold(`\n${describeHelium(install)} - ${install.dir}`));

    const current = await installedWidevine(install);
    const upToDate = current && compareVersions(current.version, source.version) >= 0;

    let reopen: string | null = null;
    if (upToDate && !options.reinstall && !options.forceDownload) {
      console.log(`${chalk.green("✔")} Widevine ${current!.version} is already installed ${chalk.dim("(use --reinstall to copy it again)")}`);
    } else {
      reopen = await closeRunningHelium(install, options, logger, "apply the fix");
      const copy = ora(`Installing ${describe(source)}...`).start();
      try {
        await installIntoHelium(install, source);
        copy.succeed(chalk.green(`Installed ${describe(source)}`));
      } catch (error) {
        copy.fail(chalk.red("Failed to install WidevineCdm"));
        logger.error("Failed to install WidevineCdm", { error });
        explainCopyError(error);
        if (reopen) await reopenHelium(reopen, logger);
        failures++;
        continue;
      }
    }

    if (options.verify !== false) {
      const check = ora("Verifying: asking Helium whether DRM works...").start();
      const result = await verifyWidevine(install);
      if (result.ok) check.succeed(chalk.green(`Verified: ${result.message}`));
      else {
        check.warn(chalk.yellow(`Couldn't verify: ${result.message}`));
        unverified++;
      }
    }

    if (getPlatform() === "darwin") await resignMac(logger);
    if (reopen) await reopenHelium(reopen, logger);
    if (reopen) console.log(chalk.dim("  Helium has been reopened."));
  }

  if (failures) exit(1);
  if (unverified) {
    console.log(chalk.yellow("\n⚠️  Widevine was installed, but Helium couldn't confirm DRM works. Restart Helium and try a DRM site;"));
    console.log(chalk.yellow("   if it still fails, try another copy: --list-sources, then --from <name>.\n"));
    exit(2);
  }
  const restart = getPlatform() === "win32" ? "" : " Restart Helium if it's open.";
  console.log(chalk.bold.green(`\n✅ Done! DRM is enabled in Helium.${restart}\n`));
}

async function resignMac(logger: Logger): Promise<void> {
  const spinner = ora("Re-signing Helium.app to include WidevineCdm...").start();
  try {
    const app = "/Applications/Helium.app";
    await execFileAsync("xattr", ["-cr", app]);
    await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", app]);
    spinner.succeed(chalk.green("Helium.app re-signed"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to re-sign Helium.app"));
    logger.error("Failed to re-sign Helium.app", { error });
    console.log(chalk.dim('   Try: sudo codesign --force --deep --sign - "/Applications/Helium.app"\n'));
  }
}

// ---------------------------------------------------------------------------
// Other commands
// ---------------------------------------------------------------------------

async function listSources(): Promise<void> {
  const spinner = ora("Searching browsers and apps for Widevine...").start();
  const sources = await findWidevineSources({ includeApps: true });
  spinner.stop();

  if (!sources.length) {
    console.log(chalk.yellow("\nNo Widevine on this computer. The fixer will download it from Google (~20 MB).\n"));
    return;
  }

  console.log(chalk.bold(`\nFound ${sources.length} Widevine cop${sources.length === 1 ? "y" : "ies"} (best first):\n`));
  sources.forEach((source, i) => {
    const marker = i === 0 ? chalk.green("→") : " ";
    const layout = source.layout === "flat" ? chalk.dim(" [converted]") : "";
    console.log(`${marker} ${chalk.bold(source.name.padEnd(40))} ${source.version.padEnd(14)}${layout}`);
    console.log(chalk.dim(`    ${source.path}`));
  });
  console.log(chalk.dim('\nUse one with --from "<name>", e.g. --from edge\n'));
}

async function status(options: FixHeliumDrmOptions, version: string): Promise<void> {
  console.log(chalk.bold.cyan(`\nHelium DRM Fixer v${version} - status\n`));

  const installs = await findHeliumInstalls({ heliumPath: options.heliumPath, all: true });
  console.log(chalk.bold("Helium"));
  if (!installs.length) console.log(`  ${chalk.red("✖")} Not found`);
  for (const install of installs) {
    console.log(`  ${chalk.green("✔")} ${describeHelium(install)}  ${chalk.dim(install.dir)}`);
    const current = await installedWidevine(install);
    if (!current) {
      console.log(`      Widevine: ${chalk.red("not installed")}`);
      continue;
    }
    const result = await verifyWidevine(install);
    const verdict = result.ok ? chalk.green("works ✔") : chalk.yellow(`not confirmed (${result.message})`);
    console.log(`      Widevine: ${current.version}, DRM ${verdict}`);
  }

  const spinner = ora("Looking for Widevine...").start();
  const sources = await findWidevineSources({ includeApps: true });
  const google = options.offline
    ? null
    : await queryGoogle(getPlatform(), installs[0]?.arch ?? "x64").catch(() => null);
  spinner.stop();

  console.log(chalk.bold("\nWidevine available"));
  if (sources[0]) {
    console.log(`  On this computer: ${sources.length} cop${sources.length === 1 ? "y" : "ies"}, newest ${sources[0].version} (${sources[0].name})`);
  } else {
    console.log(`  On this computer: ${chalk.yellow("none")}`);
  }
  if (google) console.log(`  Newest from Google: ${google.version}`);

  if (getPlatform() === "win32") {
    const auto = await isAutoFixEnabled();
    console.log(chalk.bold("\nAuto-fix after Helium updates"));
    console.log(auto ? `  ${chalk.green("On")}  ${chalk.dim(`log: ${autoFixLog()}`)}` : `  Off ${chalk.dim("(turn on with --auto)")}`);
  }
  console.log();
}

async function undo(options: FixHeliumDrmOptions, logger: Logger): Promise<void> {
  console.log(chalk.bold.cyan("\n↩️  Removing the Helium DRM fix...\n"));
  const installs = await findInstallsOrExit({ ...options, all: options.all }, logger);

  for (const install of installs) {
    if (!(await installedWidevine(install))) {
      console.log(`${chalk.green("✔")} Nothing to remove in ${chalk.dim(install.dir)}`);
      continue;
    }
    const reopen = await closeRunningHelium(install, options, logger, "remove the fix");
    try {
      const removed = await removeFromHelium(install);
      console.log(`${chalk.green("✔")} Removed ${chalk.dim(removed ?? "")}`);
    } catch (error) {
      console.log(`${chalk.red("✖")} Couldn't remove Widevine`);
      explainCopyError(error);
    } finally {
      if (reopen) await reopenHelium(reopen, logger);
    }
  }
  console.log(chalk.bold.green("\n✅ Done. Helium is back to how it was.\n"));
}

async function setAuto(state: boolean | string): Promise<void> {
  const off = typeof state === "string" && /^(off|false|no|disable)$/i.test(state);
  if (getPlatform() !== "win32") {
    console.log(chalk.green("\n✔ Not needed on Linux: the fix lives in your Helium profile and survives Helium updates.\n"));
    return;
  }

  if (off) {
    await disableAutoFix();
    console.log(chalk.green("\n✔ Auto-fix turned off and removed.\n"));
    return;
  }

  const spinner = ora("Setting up auto-fix...").start();
  try {
    await enableAutoFix();
    spinner.succeed(chalk.green("Auto-fix is on"));
    console.log(chalk.dim("   After each Helium update, the fix is re-applied automatically (at logon and every hour)."));
    console.log(chalk.dim(`   Log: ${autoFixLog()}`));
    console.log(chalk.dim("   Turn it off any time with: --auto off\n"));
  } catch (error) {
    spinner.fail(chalk.red("Couldn't set up auto-fix"));
    console.log(chalk.dim(`\n   ${errorMessage(error)}\n`));
    exit(1);
  }
}

/**
 * Hidden: run by the scheduled task. Quietly re-applies the fix to every
 * Helium that is missing Widevine or has an older one. Never closes Helium.
 */
async function autoRun(logger: Logger): Promise<void> {
  const installs = await findHeliumInstalls({ all: true });
  if (!installs.length) {
    await autoLog("Helium not found - nothing to do");
    return;
  }

  for (const install of installs) {
    const current = await installedWidevine(install);
    try {
      const source = await chooseWidevine(install.arch, logger, ora({ isEnabled: false }), {});
      if (current && compareVersions(current.version, source.version) >= 0) continue;
      await installIntoHelium(install, source);
      await autoLog(`Installed ${describe(source)} into ${install.dir}`);
    } catch (error) {
      await autoLog(`Couldn't fix ${install.dir}: ${errorMessage(error)} (will retry)`);
    }
  }
}

// ---------------------------------------------------------------------------

export async function fixHeliumDrm(options: FixHeliumDrmOptions = {}, version = "0.0.0"): Promise<void> {
  const logger = initLogger(options.verbose || false);

  if (options.autoRun) return autoRun(logger);
  if (options.listSources) return listSources();
  if (options.status) return status(options, version);
  if (options.undo) return undo(options, logger);
  if (options.auto !== undefined) return setAuto(options.auto);
  return fix(options, logger);
}
