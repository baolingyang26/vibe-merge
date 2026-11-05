"""Opt-in Codex command hook. Never persists input beyond allowlisted metadata."""
import json
import os
from pathlib import Path
import sys
import time

EVENTS = {'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'}

def metadata(payload):
    if not isinstance(payload, dict):
        return None
    session = payload.get('session_id')
    cwd = payload.get('cwd')
    event = payload.get('hook_event_name')
    if not isinstance(session, str) or not session or not isinstance(cwd, str) or not Path(cwd).is_absolute() or event not in EVENTS:
        return None
    return {'session_id': session, 'cwd': str(Path(cwd).resolve()), 'event_type': event, 'timestamp': int(time.time())}

def main():
    try:
        record = metadata(json.load(sys.stdin))
        if record is None:
            return
        target = Path(os.environ.get('GLOBAL_WORK_STATUS_EVENTS', str(Path.home() / '.codex/globalWorkStatus/events.jsonl')))
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        import fcntl
        fd = os.open(target, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, 'a') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            stream.write(json.dumps(record, separators=(',', ':')) + '\n')
    except (ValueError, OSError, TypeError):
        pass

if __name__ == '__main__':
    main()
