import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const PROJECT_MARKER = join("src", "pipeline.py");
const NAME_RE = /^video[-_ ]?memo$/i;

// System-heavy directories excluded from the two-level drive scan so the
// detection stays within a few hundred stat calls instead of walking
// C:\Windows and friends.
const SKIP_ROOT_DIRS = new Set([
  "$recycle.bin",
  "appdata",
  "perflogs",
  "program files",
  "program files (x86)",
  "programdata",
  "system volume information",
  "users",
  "windows",
  "node_modules",
]);

const HOME_PARENT_DIRS = [
  "",
  "Projects",
  "projects",
  "Code",
  "code",
  "Dev",
  "dev",
  "Repos",
  "repos",
  "Work",
  "work",
  "workspace",
  "AIApp",
  "Documents",
  "Desktop",
];

function isVideoMemoProject(dir: string): boolean {
  try {
    return existsSync(join(dir, PROJECT_MARKER));
  } catch {
    return false;
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

function collectNamed(root: string, out: string[]): void {
  for (const dir of listDirs(root)) {
    if (NAME_RE.test(basename(dir)) && isVideoMemoProject(dir) && !out.includes(dir)) {
      out.push(dir);
    }
  }
}

/**
 * Locate VideoMemo engine directories on this machine.
 *
 * Scans drive roots (two levels, skipping system folders) and common
 * development folders under the home directory for a folder named
 * VideoMemo / video-memo that contains ``src/pipeline.py``.
 */
export function detectProjectCandidates(): string[] {
  const found: string[] = [];
  const roots: string[] = [];
  if (process.platform === "win32") {
    for (let code = 67; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (existsSync(drive)) roots.push(drive);
    }
  } else {
    roots.push("/");
  }
  for (const root of roots) {
    for (const level1 of listDirs(root)) {
      const name = basename(level1).toLowerCase();
      if (NAME_RE.test(basename(level1)) && isVideoMemoProject(level1)) {
        if (!found.includes(level1)) found.push(level1);
      }
      if (SKIP_ROOT_DIRS.has(name)) continue;
      collectNamed(level1, found);
    }
  }
  const home = homedir();
  for (const parent of HOME_PARENT_DIRS) {
    collectNamed(parent ? join(home, parent) : home, found);
  }
  return found;
}
