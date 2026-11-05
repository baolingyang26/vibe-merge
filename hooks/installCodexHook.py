"""Install the minimal Global Work Status hook alongside existing Codex hooks."""
import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import tempfile
import time

EVENTS = ('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd')


def install(codex_dir: Path) -> bool:
    source = Path(__file__).with_name('codexEvents.py')
    target = codex_dir / 'hooks' / 'codexEvents.py'
    config_path = codex_dir / 'hooks.json'
    config = json.loads(config_path.read_text()) if config_path.exists() else {'hooks': {}}
    if not isinstance(config, dict) or not isinstance(config.get('hooks'), dict):
        raise ValueError('hooks.json must contain a hooks object')
    command = f'python3 {shlex.quote(str(target))}'
    changed = False
    for event in EVENTS:
        entries = config['hooks'].setdefault(event, [])
        if not isinstance(entries, list):
            raise ValueError(f'{event} hooks must be a list')
        exists = any(
            isinstance(entry, dict) and isinstance(entry.get('hooks'), list) and any(
                isinstance(hook, dict) and hook.get('command') == command
                for hook in entry['hooks']
            ) for entry in entries
        )
        if not exists:
            entries.append({'hooks': [{'type': 'command', 'command': command, 'timeout': 3}]})
            changed = True
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    target.chmod(0o700)
    if not changed:
        return False
    codex_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if config_path.exists():
        backup = codex_dir / f'hooks.json.beforeGlobalWorkStatus.{int(time.time())}'
        shutil.copyfile(config_path, backup)
        backup.chmod(0o600)
    with tempfile.NamedTemporaryFile('w', dir=codex_dir, prefix='.hooks.', suffix='.json', delete=False) as stream:
        temp_path = Path(stream.name)
        json.dump(config, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    temp_path.chmod(0o600)
    os.replace(temp_path, config_path)
    return True


if __name__ == '__main__':
    directory = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path.home() / '.codex'
    print('installed' if install(directory) else 'already installed')
