import { createInterface } from "node:readline/promises";
import chalk from "chalk";

/**
 * Leaving the program: commands throw ExitSignal instead of calling
 * process.exit(), so the CLI can pause first when it was double-clicked.
 */
export class ExitSignal extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

export function exit(code: number): never {
  throw new ExitSignal(code);
}

/**
 * Windows: true when our console window belongs to us alone - i.e. the
 * executable was double-clicked in Explorer, so the window would close
 * before the user can read the result.
 */
export function startedByDoubleClick(): boolean {
  if (process.platform !== "win32" || !process.stdin.isTTY) return false;
  try {
    const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
      GetConsoleProcessList: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    });
    const pids = new Uint32Array(8);
    const count = kernel32.symbols.GetConsoleProcessList(ptr(pids), pids.length);
    kernel32.close();
    return count === 1;
  } catch {
    return false;
  }
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function pressEnterToClose(): Promise<void> {
  await ask(chalk.dim("Press Enter to close this window..."));
}
