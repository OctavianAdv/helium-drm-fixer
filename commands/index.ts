import {
  findChromeWidevinePath,
  findHeliumVersionPath,
  findHeliumUserDataDir,
  findHeliumLinuxInstall,
  getDefaultHeliumUserDataDir,
  getPlatform,
  getSudoOwner,
} from "../lib/paths";
import { copyDir } from "../lib/utils";
import { initLogger, type Logger } from "../lib/logger";
import { downloadAndExtractChrome } from "../lib/chrome-downloader";
import { closeProcesses, findRunningProcesses } from "../lib/windows";
import { join, dirname, basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
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
}

async function getChromeWidevinePath(
  logger: Logger,
  spinner: ReturnType<typeof ora>,
  options: FixHeliumDrmOptions
): Promise<string> {
  if (options.chromePath) {
    logger.info(`Using custom Chrome path: ${options.chromePath}`);
    spinner.succeed(
      chalk.green(`Using custom Chrome path: ${options.chromePath}`)
    );
    return options.chromePath;
  }

  let chromeWidevinePath = await findChromeWidevinePath();

  if (!chromeWidevinePath) {
    spinner.text = "Chrome not found. Downloading...";
    logger.info("Chrome not found. Downloading...");
    chromeWidevinePath = await downloadAndExtractChrome({
      spinner,
      logger,
      forceDownload: options.forceDownload,
    });
    spinner.succeed(
      chalk.green("Chrome downloaded and extracted successfully")
    );
  } else {
    spinner.succeed(chalk.green(`Found Chrome at: ${chromeWidevinePath}`));
  }

  return chromeWidevinePath;
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
  chromeWidevinePath: string
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

  const manifest = JSON.parse(
    await readFile(join(chromeWidevinePath, "manifest.json"), "utf-8")
  );
  const version: string = manifest.version;

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

function reopenHelium(commandLine: string, logger: Logger): void {
  logger.info(`Reopening Helium: ${commandLine}`);
  spawn(commandLine, { shell: true, detached: true, stdio: "ignore" }).unref();
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

  console.log(chalk.bold.cyan("\n🔧 Fixing Helium DRM...\n"));

  const chromeSpinner = ora("Looking for Chrome installation...").start();
  logger.info("Looking for Chrome installation...");

  let chromeWidevinePath: string;
  try {
    chromeWidevinePath = await getChromeWidevinePath(
      logger,
      chromeSpinner,
      options
    );
  } catch (error) {
    chromeSpinner.fail(chalk.red("Failed to find/download Chrome"));
    logger.error("Failed to find/download Chrome", { error });
    if (error instanceof Error) console.log(chalk.dim(`\n   ${error.message}\n`));
    process.exit(1);
  }

  const heliumSpinner = ora("Looking for Helium installation...").start();
  logger.info("Looking for Helium installation...");

  const heliumWidevinePath = await getHeliumWidevinePath(
    logger,
    heliumSpinner,
    options,
    chromeWidevinePath
  );

  if (options.check) {
    console.log(chalk.bold.green("\n✅ Check complete. Fix can be applied.\n"));
    logger.info("Check complete. Fix can be applied.");
    return;
  }

  if (options.dryRun) {
    console.log(chalk.bold.yellow("\n🔍 Dry run - no changes made."));
    console.log(chalk.dim(`   Would copy: ${chromeWidevinePath}`));
    console.log(chalk.dim(`   To: ${heliumWidevinePath}\n`));
    logger.info("Dry run complete", {
      source: chromeWidevinePath,
      dest: heliumWidevinePath,
    });
    return;
  }

  const reopenCommand = await closeRunningHelium(heliumWidevinePath, options, logger);

  const copySpinner = ora(
    "Copying WidevineCdm from Chrome to Helium..."
  ).start();
  logger.info("Copying WidevineCdm from Chrome to Helium...");

  try {
    await copyDir(chromeWidevinePath, heliumWidevinePath);

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
    if (reopenCommand) reopenHelium(reopenCommand, logger);
    process.exit(1);
  }

  if (reopenCommand) {
    reopenHelium(reopenCommand, logger);
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
