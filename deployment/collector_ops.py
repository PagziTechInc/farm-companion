#!/usr/bin/env python3
"""Verify and activate only the isolated production artwork collector."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path('/opt/farm-companion/collector')
PUBLIC = Path('/opt/farm-companion/site/collection')
PROJECT = 'farm-companion-assets'
CONTAINER = 'farm-companion-assets-collector'
HASH = re.compile(r'[a-f0-9]{64}')
HEARTBEAT_MAX_AGE = 600


def validate_hash(value):
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError('Expected a lowercase 64-character SHA256 identifier')
    return value


def real_directory(path):
    if path.is_symlink() or not path.is_dir() or path.resolve() != path.absolute():
        raise ValueError(f'Expected a real directory: {path}')


def read_json(path, limit=1024 * 1024):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError(f'Expected a bounded regular JSON file: {path.name}')
    result = json.loads(path.read_text())
    if not isinstance(result, dict):
        raise ValueError(f'Expected a JSON object: {path.name}')
    return result


def verify(root, version):
    validate_hash(version)
    for folder in (root, root/'runtime', root/'runtime'/'versions', root/'runtime'/'versions'/version):
        real_directory(folder)
    folder = root/'runtime'/'versions'/version
    if {p.name for p in folder.iterdir()} != {'collector.mjs', 'manifest.json'}:
        raise ValueError('Collector version must contain only collector.mjs and manifest.json')
    code = folder/'collector.mjs'
    if code.is_symlink() or not code.is_file() or not 0 < code.stat().st_size <= 32 * 1024 * 1024:
        raise ValueError('Collector artifact must be a bounded regular file')
    manifest = read_json(folder/'manifest.json')
    expected = validate_hash(manifest.get('sha256'))
    if hashlib.sha256(code.read_bytes()).hexdigest() != expected:
        raise ValueError('Collector artifact checksum mismatch')
    return manifest


def current(root):
    path = root/'runtime'/'current'
    if path.is_symlink():
        value = os.readlink(path)
        if not value.startswith('versions/'):
            raise ValueError('Unexpected collector current target')
        return validate_hash(value.removeprefix('versions/'))
    if path.exists():
        raise ValueError('Refusing to replace a non-symlink current path')
    return None


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_json_atomic(path, value):
    temporary = path.with_name(path.name + '.next')
    if temporary.is_symlink() or path.is_symlink():
        raise ValueError('Unexpected activation journal symlink')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_directory(path.parent)


def switch(root, version):
    runtime = root/'runtime'
    current(root)  # Reject an unexpected existing target even for the first activation.
    temporary = runtime/'.next-collector'
    if temporary.is_symlink():
        temporary.unlink()
    elif temporary.exists():
        raise ValueError('Unexpected temporary collector path')
    if version is None:
        (runtime/'current').unlink(missing_ok=True)
    else:
        verify(root, version)
        temporary.symlink_to('versions/' + version)
        os.replace(temporary, runtime/'current')
    sync_directory(runtime)


def utc_timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Missing UTC timestamp')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError('Expected UTC timestamp')
    return parsed.timestamp()


class CollectorOps:
    def __init__(self, root=ROOT, public=PUBLIC, runner=subprocess.run,
                 now=time.time, monotonic=time.monotonic, sleep=time.sleep, wait_seconds=45):
        self.root, self.public = Path(root), Path(public)
        self.runner, self.now, self.monotonic, self.sleep = runner, now, monotonic, sleep
        self.wait_seconds = wait_seconds
        for directory in (self.root, self.root/'runtime', self.root/'runtime'/'versions', self.root/'data', self.public):
            real_directory(directory)
        # The helper never publishes raw evidence, journals, or runtime files.
        if (self.public == self.root or self.public in self.root.parents or
                self.root in self.public.parents or self.public.parent in self.root.parents):
            raise ValueError('Collector private root must be outside the public site')
        self.journal = self.root/'activation.json'

    def compose(self, *arguments):
        command = ['docker', 'compose', '-p', PROJECT, '-f', str(self.root/'compose.yaml'), *arguments, 'collector']
        result = self.runner(command, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError('Collector compose failed: ' + result.stderr.strip()[:2000])

    def service(self):
        try:
            result = self.runner(['docker', 'inspect', '--format', '{{json .State}}', CONTAINER],
                                 capture_output=True, text=True, timeout=5)
            if result.returncode:
                return {'running': False, 'health': 'missing', 'started_at': None}
            state = json.loads(result.stdout)
            return {'running': state.get('Running') is True and state.get('Status') == 'running',
                    'health': state.get('Health', {}).get('Status', 'missing'),
                    'started_at': state.get('StartedAt')}
        except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError) as error:
            return {'running': False, 'health': 'unavailable', 'started_at': None, 'error': str(error)[:300]}

    def status(self):
        version = current(self.root)
        digest = verify(self.root, version)['sha256'] if version else None
        service = self.service()
        public_status, fresh, error = None, False, None
        try:
            public_status = read_json(self.public/'status.json')
            count = public_status.get('collected_count')
            if (public_status.get('schema_version') != 1 or public_status.get('environment') != 'production' or
                    public_status.get('target_count') != 3333 or type(count) is not int or not 0 <= count <= 3333 or
                    not isinstance(public_status.get('phase'), str) or not public_status['phase']):
                raise ValueError('Invalid collector public status')
            checked = utc_timestamp(public_status.get('last_checked_at_utc'))
            started = utc_timestamp(service['started_at'])
            age = self.now() - checked
            # Both the timestamp and a write by this container instance are required.
            fresh = (-30 <= age <= HEARTBEAT_MAX_AGE and checked >= started - 1 and
                     (self.public/'status.json').stat().st_mtime >= started)
        except (OSError, ValueError, TypeError, OverflowError) as exc:
            error = str(exc)[:300]
        result = {'current': version, 'code_sha256': digest, 'service': service,
                  'public_status': public_status, 'public_status_fresh': fresh,
                  'healthy': service['running'] and service['health'] == 'healthy' and fresh,
                  'pending_activation': self.journal.exists()}
        if error:
            result['status_error'] = error
        return result

    def wait_healthy(self):
        deadline = self.monotonic() + self.wait_seconds
        while True:
            result = self.status()
            if result['healthy']:
                return result
            remaining = deadline - self.monotonic()
            if remaining <= 0:
                raise RuntimeError('Collector did not produce a fresh healthy heartbeat within startup deadline')
            self.sleep(min(1, remaining))

    def clear_journal(self):
        self.journal.unlink()
        sync_directory(self.root)

    def recover_pending(self):
        if not self.journal.exists() and not self.journal.is_symlink():
            return False
        intent = read_json(self.journal)
        candidate = validate_hash(intent.get('candidate'))
        previous = intent.get('previous')
        if previous is not None:
            verify(self.root, validate_hash(previous))
        if current(self.root) not in (candidate, previous):
            raise RuntimeError('Current collector changed; refusing an unrelated rollback')
        switch(self.root, previous)
        if previous is None:
            self.compose('stop')
        else:
            self.compose('up', '-d', '--no-deps', '--force-recreate')
            self.wait_healthy()
        self.clear_journal()
        return True

    def activate(self, version):
        validate_hash(version)
        # Complete a interrupted rollback before any unchanged-artifact shortcut.
        self.recover_pending()
        candidate = verify(self.root, version)
        before = self.status()
        previous = before['current']
        if before['code_sha256'] == candidate['sha256'] and before['healthy']:
            return dict(before, changed=False, requested=version)
        write_json_atomic(self.journal, {'candidate': version, 'previous': previous,
                          'started_at_utc': datetime.fromtimestamp(self.now(), timezone.utc).isoformat()})
        try:
            switch(self.root, version)
            self.compose('up', '-d', '--no-deps', '--force-recreate')
            result = self.wait_healthy()
            self.clear_journal()
        except Exception as error:
            try:
                self.recover_pending()
            except Exception as recovery_error:
                raise RuntimeError(f'{error}; rollback pending: {recovery_error}') from error
            raise RuntimeError(f'{error}; previous collector restored') from error
        return dict(result, changed=True, requested=version, previous=previous, pending_activation=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['activate', 'status', 'recover'])
    parser.add_argument('version', nargs='?')
    args = parser.parse_args()
    ops = CollectorOps()
    lock_fd = os.open(ROOT/'.activation.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == 'activate':
            result = ops.activate(args.version)
        elif args.command == 'recover':
            recovered = ops.recover_pending()
            result = dict(ops.status(), recovered=recovered)
        else:
            result = ops.status()
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(1)
