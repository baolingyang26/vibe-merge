import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./codexEvents.py", import.meta.url));

test("records only allowlisted metadata from official hook input", () => {
  const directory = mkdtempSync(join(tmpdir(), "codexEventsSpec"));
  const log = join(directory, "events.jsonl");
  try {
    const result = spawnSync("python3", [script], {
      input: JSON.stringify({ session_id: "sessionA", cwd: directory, hook_event_name: "Stop", prompt: "SECRET", tool_input: "CODE", transcript_path: "/secret" }),
      env: { ...process.env, GLOBAL_WORK_STATUS_EVENTS: log },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    const record = JSON.parse(readFileSync(log, "utf8"));
    expect(Object.keys(record).sort()).toEqual(["cwd", "event_type", "session_id", "timestamp"]);
    expect(record.session_id).toBe("sessionA");
    expect(record.cwd).toBe(realpathSync(directory));
    expect(record.event_type).toBe("Stop");
    expect(typeof record.timestamp).toBe("number");
    expect(readFileSync(log, "utf8")).not.toContain("SECRET");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not write an event without session identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "codexEventsSpec"));
  const log = join(directory, "events.jsonl");
  try {
    const result = spawnSync("python3", [script], {
      input: JSON.stringify({ cwd: directory, hook_event_name: "Stop" }),
      env: { ...process.env, GLOBAL_WORK_STATUS_EVENTS: log },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(existsSync(log)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
