#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { fixHeliumDrm } from "./commands/index";
import { ExitSignal, pressEnterToClose, startedByDoubleClick } from "./lib/console";
import { checkForUpdate } from "./lib/update-check";
import { detectLanguage, setLanguage, t, LANGUAGES } from "./lib/i18n";
import pkg from "./package.json" with { type: "json" };

const program = new Command();

program
  .name("fix-helium-drm")
  .description(
    "Fix DRM in Helium browser by installing Widevine from your other browsers, or from Google"
  )
  .version(pkg.version)
  .option("--status", "Show Helium, its Widevine, whether DRM works, and auto-fix state")
  .option("--check", "Check if the fix can be applied, without changing anything")
  .option("--dry-run", "Show what would be done, without changing anything")
  .option("--list-sources", "List every Widevine copy found on this computer")
  .option("--from <browser>", "Take Widevine from this browser or app (e.g. edge, brave, firefox, spotify)")
  .option("--latest", "Ask Google for a newer Widevine than the ones on this computer")
  .option("--offline", "Never download anything; use only Widevine already on this computer")
  .option("--force-download", "Download Widevine from Google even if a local copy exists")
  .option("--chrome-path <path>", "Use the Widevine folder at this path (Chromium or Firefox layout)")
  .option(
    "--helium-path <path>",
    "Use this Helium folder: version/portable folder (Windows/macOS) or profile folder (Linux)"
  )
  .option("--all", "Fix every Helium found (e.g. installed and portable)")
  .option("--reinstall", "Copy Widevine again even if Helium already has the same version")
  .option("--no-verify", "Skip checking that DRM works in Helium afterwards")
  .option("-y, --yes", "Close and reopen Helium without asking (Windows, macOS)")
  .option("--undo", "Remove the fix from Helium")
  .option("--auto [on|off]", "Re-apply the fix automatically after Helium updates (Windows, macOS)")
  .option("--auto-run", "(used by --auto's scheduled task)")
  .option("--lang <code>", `Language: ${Object.keys(LANGUAGES).join(", ")} (default: your system language)`)
  .option("--json", "With --status or --list-sources: print JSON")
  .option("--verbose", "Show every location checked and every decision made")
  .option("--debug", "Same as --verbose")
  .action(async (options) => {
    setLanguage(detectLanguage(options.lang));
    const doubleClicked = startedByDoubleClick();
    const update = options.autoRun || options.json ? Promise.resolve(null) : checkForUpdate(pkg.version);
    let code = 0;

    try {
      await fixHeliumDrm(
        {
          verbose: options.verbose || options.debug,
          check: options.check,
          dryRun: options.dryRun,
          chromePath: options.chromePath,
          heliumPath: options.heliumPath,
          forceDownload: options.forceDownload,
          yes: options.yes,
          listSources: options.listSources,
          from: options.from,
          all: options.all,
          verify: options.verify,
          status: options.status,
          undo: options.undo,
          auto: options.auto,
          autoRun: options.autoRun,
          latest: options.latest,
          offline: options.offline,
          reinstall: options.reinstall,
          json: options.json,
        },
        pkg.version
      );
    } catch (error) {
      if (error instanceof ExitSignal) {
        code = error.code;
      } else {
        console.error(chalk.red("Error:"), error);
        code = 1;
      }
    }

    const newer = await update;
    if (newer) {
      console.log(chalk.yellow(t("updateAvailable", { latest: newer, current: pkg.version })));
      console.log(chalk.dim(`   ${t("getIt", { url: "https://github.com/OctavianAdv/helium-drm-fixer#-quick-start" })}\n`));
    }

    if (doubleClicked) await pressEnterToClose();
    process.exit(code);
  });

program.parse();
