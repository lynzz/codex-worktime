import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/index.js";

describe("data commands", () => {
  it("backs up and deletes explicit application-owned paths without writing to a Project Profile root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-worktime-data-cli-"));
    const dataDirectory = join(directory, "data");
    const projectRoot = join(directory, "project");
    const backupDirectory = join(directory, "backup");
    const databasePath = join(dataDirectory, "analytics.sqlite");
    const reportPath = join(directory, "exports", "report.html");
    await Promise.all([mkdir(dataDirectory, { recursive: true }), mkdir(projectRoot, { recursive: true }), mkdir(join(directory, "exports"), { recursive: true })]);
    await Promise.all([writeFile(databasePath, "SAFE_DATABASE"), writeFile(reportPath, "INDEPENDENT_REPORT")]);
    let output = "";
    const runtime = { stdout: { write: (chunk: string) => { output += chunk; return true; } } };

    await runCli(["node", "codex-worktime", "data", "backup", "--data-dir", dataDirectory, "--path", databasePath, "--project-root", projectRoot, "--output", backupDirectory], runtime);
    expect(await readFile(join(backupDirectory, "analytics.sqlite"), "utf8")).toBe("SAFE_DATABASE");

    await runCli(["node", "codex-worktime", "data", "delete", "--data-dir", dataDirectory, "--path", databasePath, "--project-root", projectRoot, "--retained-export", reportPath, "--confirm", "DELETE_LOCAL_DATA"], runtime);
    await expect(access(databasePath)).rejects.toThrow();
    expect(await readFile(reportPath, "utf8")).toBe("INDEPENDENT_REPORT");
    expect(output).toContain('"backedUpCount":1');
    expect(output).toContain('"deletedCount":1');
    expect(output).not.toContain(projectRoot);
  });
});
