import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { backupLocalData, deleteLocalData } from "../src/lifecycle/manage-local-data.js";

describe("local data lifecycle", () => {
  it("backs up only explicitly declared application-data files outside project roots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-lifecycle-"));
    const dataDirectory = join(directory, "application-data");
    const backupDirectory = join(directory, "backup");
    const analytics = join(dataDirectory, "analytics.sqlite");
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(analytics, "SAFE_ANALYTICS");

    const result = await backupLocalData({
      applicationDataDirectory: dataDirectory,
      backupDirectory,
      ownedPaths: [analytics],
      projectRoots: [join(directory, "project")]
    });

    expect(result.backedUpPaths).toEqual([join(backupDirectory, "analytics.sqlite")]);
    expect(await readFile(join(backupDirectory, "analytics.sqlite"), "utf8")).toBe("SAFE_ANALYTICS");
  });

  it("deletes only explicitly declared application-owned data and leaves exports intact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-lifecycle-"));
    const dataDirectory = join(directory, "application-data");
    const analytics = join(dataDirectory, "analytics.sqlite");
    const profile = join(dataDirectory, "profiles", "eqa.json");
    const exportedReport = join(directory, "exports", "report.html");
    await Promise.all([
      mkdir(join(dataDirectory, "profiles"), { recursive: true }),
      mkdir(join(directory, "exports"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(analytics, "SAFE_ANALYTICS"),
      writeFile(profile, "SAFE_PROFILE"),
      writeFile(exportedReport, "INDEPENDENT_EXPORT")
    ]);

    const result = await deleteLocalData({
      applicationDataDirectory: dataDirectory,
      ownedPaths: [analytics, profile],
      projectRoots: [join(directory, "project")],
      retainedExports: [exportedReport]
    });

    expect(result.deletedPaths).toEqual([analytics, profile]);
    await expect(access(analytics)).rejects.toThrow();
    await expect(access(profile)).rejects.toThrow();
    expect(await readFile(exportedReport, "utf8")).toBe("INDEPENDENT_EXPORT");
    expect(result.retainedExports).toEqual([exportedReport]);
  });

  it("refuses to back up or delete a path in a configured project root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-lifecycle-"));
    const projectRoot = join(directory, "project");
    const projectData = join(projectRoot, "analytics.sqlite");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(projectData, "MUST_NOT_TOUCH");

    await expect(deleteLocalData({
      applicationDataDirectory: directory,
      ownedPaths: [projectData],
      projectRoots: [projectRoot],
      retainedExports: []
    })).rejects.toThrow("outside configured project roots");
  });

  it("rejects symbolic-link traversal and retained exports that overlap deletion targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-lifecycle-"));
    const dataDirectory = join(directory, "application-data");
    const projectRoot = join(directory, "project");
    const projectData = join(projectRoot, "analytics.sqlite");
    const linkedProject = join(dataDirectory, "linked-project");
    await Promise.all([mkdir(dataDirectory, { recursive: true }), mkdir(projectRoot, { recursive: true })]);
    await writeFile(projectData, "MUST_NOT_TOUCH");
    await symlink(projectRoot, linkedProject);

    await expect(backupLocalData({
      applicationDataDirectory: dataDirectory,
      backupDirectory: join(directory, "backup"),
      ownedPaths: [join(linkedProject, "analytics.sqlite")],
      projectRoots: [projectRoot]
    })).rejects.toThrow("symbolic links");

    const analytics = join(dataDirectory, "analytics.sqlite");
    await writeFile(analytics, "SAFE_ANALYTICS");
    await expect(deleteLocalData({
      applicationDataDirectory: dataDirectory,
      ownedPaths: [analytics],
      projectRoots: [projectRoot],
      retainedExports: [analytics]
    })).rejects.toThrow("must not overlap");
    expect(await readFile(analytics, "utf8")).toBe("SAFE_ANALYTICS");

    const retainedSymlink = join(directory, "retained-link.sqlite");
    await symlink(analytics, retainedSymlink);
    await expect(deleteLocalData({
      applicationDataDirectory: dataDirectory,
      ownedPaths: [analytics],
      projectRoots: [projectRoot],
      retainedExports: [retainedSymlink]
    })).rejects.toThrow("must not overlap");
    expect(await readFile(analytics, "utf8")).toBe("SAFE_ANALYTICS");
  });
});
