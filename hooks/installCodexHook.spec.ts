import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('installer preserves existing hooks and is idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'global-work-status-hooks-'));
  try {
    const original = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python3 /existing/hook.py' }] }] }, otherSetting: true };
    writeFileSync(join(directory, 'hooks.json'), JSON.stringify(original));
    const script = join(import.meta.dir, 'installCodexHook.py');
    const first = Bun.spawnSync(['python3', script, directory]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString().trim()).toBe('installed');
    const config = JSON.parse(readFileSync(join(directory, 'hooks.json'), 'utf8'));
    expect(config.otherSetting).toBe(true);
    expect(config.hooks.Stop).toHaveLength(2);
    expect(config.hooks.Stop[0]).toEqual(original.hooks.Stop[0]);
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(readFileSync(join(directory, 'hooks', 'codexEvents.py'), 'utf8')).toContain('Opt-in Codex command hook');
    const second = Bun.spawnSync(['python3', script, directory]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout.toString().trim()).toBe('already installed');
    expect(JSON.parse(readFileSync(join(directory, 'hooks.json'), 'utf8')).hooks.Stop).toHaveLength(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
