import { cp, lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type LocalDataPaths = {
  applicationDataDirectory: string;
  ownedPaths: readonly string[];
  projectRoots: readonly string[];
};

export type BackupLocalDataInput = LocalDataPaths & { backupDirectory: string };
export type DeleteLocalDataInput = LocalDataPaths & { retainedExports: readonly string[] };

function isWithinDirectory(path: string, directory: string): boolean {
  const difference = relative(directory, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

async function canonicalize(path: string): Promise<string> {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...suffix);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

async function rejectSymlinkComponents(path: string, directory: string): Promise<void> {
  let cursor = resolve(directory);
  if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Application-data directory must not be a symbolic link");
  for (const component of relative(cursor, resolve(path)).split("/").filter(Boolean)) {
    cursor = join(cursor, component);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw new Error("Application-owned paths must not traverse symbolic links");
      }
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function validateOwnedPaths(input: LocalDataPaths): Promise<string[]> {
  const dataDirectory = resolve(input.applicationDataDirectory);
  if (input.projectRoots.length === 0) throw new Error("At least one configured Project Profile root is required");
  if (input.ownedPaths.length === 0) throw new Error("At least one application-owned path is required");
  await stat(dataDirectory);
  const canonicalDataDirectory = await canonicalize(dataDirectory);
  const canonicalProjectRoots = await Promise.all(input.projectRoots.map((root) => canonicalize(root)));
  const paths = [...new Set(input.ownedPaths.map((path) => resolve(path)))];
  for (const path of paths) {
    if (path === dataDirectory || !isWithinDirectory(path, dataDirectory)) {
      throw new Error("Application-owned data must be an explicit path inside the application-data directory");
    }
    await rejectSymlinkComponents(path, dataDirectory);
    const canonicalPath = await canonicalize(path);
    if (!isWithinDirectory(canonicalPath, canonicalDataDirectory) || canonicalProjectRoots.some((root) => isWithinDirectory(canonicalPath, root))) {
      throw new Error("Application-owned data must be outside configured project roots");
    }
  }
  return paths;
}

export async function backupLocalData(input: BackupLocalDataInput): Promise<{ backedUpPaths: string[] }> {
  const paths = await validateOwnedPaths(input);
  const backupDirectory = resolve(input.backupDirectory);
  const [canonicalBackupDirectory, canonicalDataDirectory, canonicalProjectRoots] = await Promise.all([
    canonicalize(backupDirectory),
    canonicalize(input.applicationDataDirectory),
    Promise.all(input.projectRoots.map((root) => canonicalize(root)))
  ]);
  if (isWithinDirectory(canonicalBackupDirectory, canonicalDataDirectory) || canonicalProjectRoots.some((root) => isWithinDirectory(canonicalBackupDirectory, root))) {
    throw new Error("Backup destination must be outside configured project roots");
  }
  await mkdir(backupDirectory, { recursive: true });
  const backedUpPaths: string[] = [];
  for (const path of paths) {
    try {
      await stat(path);
    } catch {
      continue;
    }
    const destination = resolve(backupDirectory, basename(path));
    await cp(path, destination, { recursive: true, force: false, errorOnExist: true });
    backedUpPaths.push(destination);
  }
  return { backedUpPaths };
}

export async function deleteLocalData(input: DeleteLocalDataInput): Promise<{ deletedPaths: string[]; retainedExports: string[] }> {
  const paths = await validateOwnedPaths(input);
  const retainedExports = [...new Set(input.retainedExports.map((path) => resolve(path)))];
  const canonicalOwnedPaths = await Promise.all(paths.map((path) => canonicalize(path)));
  for (const exportedPath of retainedExports) {
    const canonicalExportedPath = await canonicalize(exportedPath);
    if (canonicalOwnedPaths.some((ownedPath) => isWithinDirectory(canonicalExportedPath, ownedPath) || isWithinDirectory(ownedPath, canonicalExportedPath))) {
      throw new Error("Retained exports must not overlap application-owned deletion targets");
    }
    await stat(exportedPath);
  }
  const deletedPaths: string[] = [];
  for (const path of paths) {
    try {
      await stat(path);
    } catch {
      continue;
    }
    await rm(path, { recursive: true, force: false });
    deletedPaths.push(path);
  }
  for (const exportedPath of retainedExports) await stat(exportedPath);
  return { deletedPaths, retainedExports };
}
