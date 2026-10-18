#!/usr/bin/env bun
import { Command } from "commander";
import { fixHeliumDrm } from "./commands/index";
import pkg from "./package.json" with { type: "json" };

const program = new Command();

program
  .name("fix-helium-drm")
  .description(
    "Fix DRM in Helium browser by installing Widevine from your other browsers"
  )
  .version(pkg.version)
  .option("--check", "Check if fix is needed without applying changes")
  .option("--dry-run", "Show what would be done without making changes")
  .option("--verbose", "Enable verbose logging")
  .option("--debug", "Enable debug logging (alias for --verbose)")
  .option("--chrome-path <path>", "Use the WidevineCdm folder at this path")
  .option("--from <browser>", "Take Widevine from this browser or app (e.g. edge, brave, firefox, spotify)")
  .option("--list-sources", "List every Widevine copy found on this computer")
  .option(
    "--helium-path <path>",
    "Custom Helium version folder (Windows/macOS) or profile folder (Linux)"
  )
  .option("--force-download", "Force re-download Chrome even if cached")
  .option("-y, --yes", "Close and reopen Helium without asking (Windows)")
  .action(async (options) => {
    try {
      await fixHeliumDrm({
        verbose: options.verbose || options.debug,
        check: options.check,
        dryRun: options.dryRun,
        chromePath: options.chromePath,
        heliumPath: options.heliumPath,
        forceDownload: options.forceDownload,
        yes: options.yes,
        listSources: options.listSources,
        from: options.from,
      });
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program.parse();
