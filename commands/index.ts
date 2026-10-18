import {
  findHeliumVersionPath,
  findHeliumUserDataDir,
  findHeliumLinuxInstall,
  getDefaultHeliumUserDataDir,
  getPlatform,
  getSudoOwner,
} from "../lib/paths";
import {
  findWidevineSources,
  installWidevine,
  readWidevine,
  type WidevineSource,
} from "../lib/widevine";
import { initLogger, type Logger } from "../lib/logger";
import { downloadAndExtractChrome } from "../lib/chrome-downloader";
import {
  closeProcesses,
  findRunningProcesses,
  startIndependentProcess,
} from "../lib/windows";
import { join, dirname, basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import ora from "ora";

const execFileAsync = promisify(execFile);
import chalk from "chalk";

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
}

function describe(source: WidevineSource): string {
  return `Widevine ${source.version} from ${source.name}`;
}

/**
 * Pick the Widevine to install: --chrome-path, --from <browser>, or the
 * newest copy any browser/app on this machine has. Download Chrome only
 * when there is none.
 */
async function getWidevineSource(
  logger: Logger,
  spinner: ReturnType<typeof ora>,
  options: FixHeliumDrmOptions
): Promise<WidevineSource> {
  if (options.chromePath) {
    const source = await readWidevine(options.chromePath, "custom path");
    if (!source) {
      throw new Error(
        `No usable Widevine in ${options.chromePath} (needs manifest.json and the CDM library for this system)`
      );
    }
    spinner.succeed(chalk.green(`Using ${describe(source)}: ${source.path}`));
    return source;
  }

  if (!options.forceDownload) {
    const sources = await findWidevineSources({ includeApps: Boolean(options.from) });
    const candidates = options.from
      ? sources.filter((s) => s.name.toLowerCase().includes(options.from!.toLowerCase()))
      : sources;

    if (options.from && !candidates.length) {
      const available = [...new Set(sources.map((s) => s.name))].join(", ") || "none";
      throw new Error(`No Widevine found from "${options.from}". Available: ${available}`);
    }

    const best = candidates[0];
    if (best) {
      const others = sources.length - 1;
      spinner.succeed(
        chalk.green(`Using ${describe(best)}`) +
          chalk.dim(others > 0 ? ` (${others} other cop${others === 1 ? "y" : "ies"} found)` : "")
      );
      logger.info(`Widevine source: ${best.path}`);
      return best;
    }
  }

  spinner.text = "No Widevine found on this computer. Downloading Chrome...";
  logger.info("No Widevine found. Downloading Chrome...");
  const downloaded = await downloadAndExtractChrome({
    spinner,
    logger,
    forceDownload: options.forceDownload,
  });
  const source = await readWidevine(downloaded, "Google Chrome (downloaded)");
  if (!source) throw new Error("The downloaded Chrome has no usable Widevine");
  spinner.succeed(chalk.green(`Using ${describe(source)}`));
  return source;
}

/**
 * --list-sources: print every Widevine copy found, best first.
 */
async function listSources(): Promise<void> {
  const spinner = ora("Searching browsers and apps for Widevine...").start();
  const sources = await findWidevineSources({ includeApps: true });
  spinner.stop();

  if (!sources.length) {
    console.log(chalk.yellow("\nNo Widevine found. The fixer will download Chrome to get it.\n"));
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

function exitHeliumNotFound(
  spinner: ReturnType<typeof ora>,
  logger: Logger
): never {
  spinner.fail(chalk.red("Helium browser not found"));
  console.log(chalk.yellow("\n⚠️  Please install Helium first."));
  console.log(chalk.blue("   Download from: https://helium.is/\n"));
  logger.error("Helium browser not found. Please install Helium first.");
  process.exit(1);
}

/**
 * Where WidevineCdm goes. On Windows/macOS that is inside Helium's newest
 * version folder; on Linux it is Helium's profile folder, laid out like
 * Chromium's component updater: <profile>/WidevineCdm/<cdm version>/
 */
async function getHeliumWidevinePath(
  logger: Logger,
  spinner: ReturnType<typeof ora>,
  options: FixHeliumDrmOptions,
  widevine: WidevineSource
): Promise<string> {
  if (getPlatform() !== "linux") {
    const heliumVersionPath =
      options.heliumPath ?? (await findHeliumVersionPath());
    if (!heliumVersionPath) exitHeliumNotFound(spinner, logger);

    spinner.succeed(chalk.green(`Found Helium at: ${heliumVersionPath}`));
    logger.info(`Found Helium at: ${heliumVersionPath}`);
    return join(heliumVersionPath, "WidevineCdm");
  }

  let userDataDir = options.heliumPath ?? (await findHeliumUserDataDir());
  if (!userDataDir) {
    // Helium is installed but was never opened: set up its profile folder ourselves
    const install = await findHeliumLinuxInstall();
    if (!install) exitHeliumNotFound(spinner, logger);

    userDataDir = getDefaultHeliumUserDataDir();
    logger.info(`Helium found at ${install}, but no profile yet. Using ${userDataDir}`);
  }

  const version = widevine.version;

  spinner.succeed(chalk.green(`Found Helium profile at: ${userDataDir}`));
  const heliumWidevinePath = join(userDataDir, "WidevineCdm", version);
  logger.info(`Using Linux component updater path: ${heliumWidevinePath}`);
  return heliumWidevinePath;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Windows locks Helium's files while it runs. If Helium is open from the
 * folder we are about to change, close it (after asking) and return the
 * command line to reopen it with afterwards.
 */
async function closeRunningHelium(
  heliumWidevinePath: string,
  options: FixHeliumDrmOptions,
  logger: Logger
): Promise<string | null> {
  if (getPlatform() !== "win32") return null;

  // Application\<version>\WidevineCdm -> Application; portable -> its folder
  let appRoot = dirname(heliumWidevinePath);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(basename(appRoot))) appRoot = dirname(appRoot);
  const prefix = appRoot.toLowerCase() + "\\";

  const running = (await findRunningProcesses("chrome.exe")).filter((p) =>
    p.path.toLowerCase().startsWith(prefix)
  );
  if (!running.length) return null;

  logger.info(`Helium is running (${running.length} processes)`);
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.log(chalk.yellow("\n⚠️  Helium is open. If copying fails, close Helium or run with --yes.\n"));
      return null;
    }
    const answer = await ask(
      chalk.yellow("\nHelium is open. Close it now to apply the fix? It will reopen afterwards. [Y/n] ")
    );
    if (/^n/i.test(answer.trim())) {
      console.log(chalk.dim("\n   Close Helium and run this again when you're ready.\n"));
      process.exit(0);
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
    console.log(
      chalk.yellow("\n⚠️  WidevineCdm is in use. Close Helium completely and try again.")
    );
    if (getPlatform() === "win32") {
      console.log(
        chalk.dim(
          "   If Helium is installed for all users (Program Files), run this from an Administrator terminal.\n"
        )
      );
    }
  } else if (code === "EACCES" || code === "EPERM") {
    console.log(
      chalk.yellow("\n⚠️  Permission denied. Run again with sudo, or check folder permissions.\n")
    );
  } else if (error instanceof Error) {
    console.log(chalk.dim(`\n   ${error.message}\n`));
  }
}

export async function fixHeliumDrm(options: FixHeliumDrmOptions = {}) {
  const logger = initLogger(options.verbose || false);

  if (options.listSources) {
    await listSources();
    return;
  }

  console.log(chalk.bold.cyan("\n🔧 Fixing Helium DRM...\n"));

  const widevineSpinner = ora("Looking for Widevine in your browsers...").start();
  logger.info("Looking for Widevine...");

  let widevine: WidevineSource;
  try {
    widevine = await getWidevineSource(logger, widevineSpinner, options);
  } catch (error) {
    widevineSpinner.fail(chalk.red("Failed to find or download Widevine"));
    logger.error("Failed to find or download Widevine", { error });
    if (error instanceof Error) console.log(chalk.dim(`\n   ${error.message}\n`));
    process.exit(1);
  }

  const heliumSpinner = ora("Looking for Helium installation...").start();
  logger.info("Looking for Helium installation...");

  const heliumWidevinePath = await getHeliumWidevinePath(
    logger,
    heliumSpinner,
    options,
    widevine
  );

  if (options.check) {
    console.log(chalk.bold.green("\n✅ Check complete. Fix can be applied.\n"));
    logger.info("Check complete. Fix can be applied.");
    return;
  }

  if (options.dryRun) {
    console.log(chalk.bold.yellow("\n🔍 Dry run - no changes made."));
    console.log(chalk.dim(`   Would copy: ${widevine.path} (${describe(widevine)})`));
    console.log(chalk.dim(`   To: ${heliumWidevinePath}\n`));
    logger.info("Dry run complete", {
      source: widevine.path,
      dest: heliumWidevinePath,
    });
    return;
  }

  const reopenCommand = await closeRunningHelium(heliumWidevinePath, options, logger);

  const copySpinner = ora(`Copying WidevineCdm from ${widevine.name} to Helium...`).start();
  logger.info(`Copying WidevineCdm from ${widevine.path} to Helium...`);

  try {
    await installWidevine(widevine, heliumWidevinePath);

    // On Linux, write the component updater hint file so Chromium finds the CDM
    if (getPlatform() === "linux") {
      const widevineRoot = dirname(heliumWidevinePath);
      const hintFile = join(widevineRoot, "latest-component-updated-widevine-cdm");
      await writeFile(hintFile, JSON.stringify({ Path: heliumWidevinePath }));
      logger.info(`Wrote hint file: ${hintFile}`);

      // Under sudo, give the files back to the user so Helium can read them
      const owner = getSudoOwner();
      if (owner) {
        const ownerArg = `${owner.uid}:${owner.gid}`;
        await execFileAsync("chown", ["-R", ownerArg, widevineRoot]);
        // The profile folder itself, in case we just created it
        await execFileAsync("chown", [ownerArg, dirname(widevineRoot)]);
        logger.info(`Changed owner of ${widevineRoot} to ${owner.uid}:${owner.gid}`);
      }
    }

    copySpinner.succeed(chalk.green("WidevineCdm copied successfully!"));
    logger.info("WidevineCdm copied successfully!");
  } catch (error) {
    copySpinner.fail(chalk.red("Failed to copy WidevineCdm"));
    logger.error("Failed to copy WidevineCdm", { error });
    explainCopyError(error);
    if (reopenCommand) await reopenHelium(reopenCommand, logger);
    process.exit(1);
  }

  if (reopenCommand) {
    await reopenHelium(reopenCommand, logger);
    console.log(chalk.bold.green("\n✅ Done! Helium has been reopened with DRM enabled.\n"));
    logger.info("Done! Helium reopened.");
    return;
  }

  if (getPlatform() === "darwin") {
    const signSpinner = ora("Re-signing Helium.app to include WidevineCdm...").start();
    logger.info("Re-signing Helium.app after modifying framework contents...");

    try {
      const heliumAppPath = "/Applications/Helium.app";
      await execFileAsync("xattr", ["-cr", heliumAppPath]);
      await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", heliumAppPath]);
      signSpinner.succeed(chalk.green("Helium.app re-signed successfully"));
      logger.info("Helium.app re-signed successfully");
    } catch (error) {
      signSpinner.fail(chalk.red("Failed to re-sign Helium.app"));
      logger.error("Failed to re-sign Helium.app", { error });
      console.log(chalk.yellow("\n⚠️  You may need to run with sudo, or manually run:"));
      console.log(chalk.dim('   codesign --force --deep --sign - "/Applications/Helium.app"\n'));
    }
  }

  console.log(
    chalk.bold.green("\n✅ Done! Restart Helium browser for DRM to work.\n")
  );
  logger.info("Done! Restart Helium browser for DRM to work.");
}
