"""Collector deployment safety with fake Docker, clocks and temporary files."""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('collector_ops', PROJECT/'deployment'/'collector_ops.py')
ops_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops_module)
A, B, C = 'a' * 64, 'b' * 64, 'c' * 64


class FakeDocker:
    def __init__(self, root, public):
        self.root, self.public = root, public
        self.clock = 1789420000.0
        self.commands = []
        self.state = None
        self.fail_versions = set()
        self.crash_versions = set()
        self.stale_versions = set()
        self.phase = 'waiting_for_reveal'

    def timestamp(self, value=None):
        return datetime.fromtimestamp(self.clock if value is None else value, timezone.utc).isoformat()

    def sleep(self, seconds):
        self.clock += seconds

    def write_status(self, checked=None, modified=None, **extra):
        value = {'schema_version': 1, 'environment': 'production', 'target_count': 3333,
                 'collected_count': 0, 'phase': self.phase, 'observed_at_utc': None,
                 'last_checked_at_utc': self.timestamp(checked), 'chain_observation': None}
        value.update(extra)
        path = self.public/'status.json'
        path.write_text(json.dumps(value))
        when = self.clock if modified is None else modified
        os.utime(path, (when, when))

    def start(self):
        self.clock += 2
        self.state = {'Running': True, 'Status': 'running', 'StartedAt': self.timestamp(),
                      'Health': {'Status': 'healthy'}}
        self.write_status()

    def run(self, command, **kwargs):
        self.commands.append(command)
        if command[:2] == ['docker', 'inspect']:
            if self.state is None:
                return subprocess.CompletedProcess(command, 1, '', 'No such container')
            return subprocess.CompletedProcess(command, 0, json.dumps(self.state), '')
        assert command[:4] == ['docker', 'compose', '-p', 'farm-companion-assets']
        assert command[4:6] == ['-f', str(self.root/'compose.yaml')]
        assert command[-1] == 'collector'
        if command[6] == 'stop':
            self.state = None
            return subprocess.CompletedProcess(command, 0, '', '')
        assert command[6:-1] == ['up', '-d', '--no-deps', '--force-recreate']
        version = ops_module.current(self.root)
        if version in self.crash_versions:
            raise KeyboardInterrupt('lost deploy process')
        if version in self.fail_versions:
            return subprocess.CompletedProcess(command, 1, '', 'synthetic failure')
        if version in self.stale_versions:
            self.clock += 2
            self.state = {'Running': True, 'Status': 'running', 'StartedAt': self.timestamp(),
                          'Health': {'Status': 'healthy'}}
        else:
            self.start()
        return subprocess.CompletedProcess(command, 0, '', '')

    def mutations(self):
        return [command for command in self.commands if command[1] == 'compose']


class CollectorDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root, self.public = self.base/'collector', self.base/'site'/'collection'
        (self.root/'runtime'/'versions').mkdir(parents=True)
        (self.root/'data'/'raw').mkdir(parents=True)
        self.public.mkdir(parents=True)
        self.raw = self.root/'data'/'raw'/'1.json'
        self.raw.write_text('{"private_evidence":true}')
        self.docker = FakeDocker(self.root, self.public)
        self.ops = ops_module.CollectorOps(self.root, self.public, runner=self.docker.run,
            now=lambda: self.docker.clock, monotonic=lambda: self.docker.clock,
            sleep=self.docker.sleep, wait_seconds=3)

    def stage(self, version, code=None):
        code = code or 'export const version = "' + version + '";\n'
        folder = self.root/'runtime'/'versions'/version
        folder.mkdir()
        (folder/'collector.mjs').write_text(code)
        digest = hashlib.sha256(code.encode()).hexdigest()
        (folder/'manifest.json').write_text(json.dumps({'sha256': digest}))
        return folder

    def active(self, version=A, code=None):
        self.stage(version, code)
        ops_module.switch(self.root, version)
        self.docker.start()

    def pending(self, candidate=B, previous=A):
        ops_module.write_json_atomic(self.ops.journal, {'candidate': candidate, 'previous': previous})

    def test_validated_identifiers_reject_traversal_uppercase_and_wrong_lengths(self):
        for value in ('../' + A, 'A' * 64, 'a' * 63, A + '\n', None, 123):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.ops.activate(value)
        self.assertFalse(self.docker.commands)

    def test_checksum_and_exact_artifact_allowlist(self):
        folder = self.stage(A)
        (folder/'collector.mjs').write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            ops_module.verify(self.root, A)
        (folder/'wallets.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'only collector'):
            ops_module.verify(self.root, A)

    def test_reject_symlink_artifact_manifest_and_runtime(self):
        folder = self.stage(A)
        for filename in ('collector.mjs', 'manifest.json'):
            path = folder/filename
            saved = path.read_bytes()
            path.unlink()
            path.symlink_to(self.raw)
            with self.subTest(filename=filename), self.assertRaises(ValueError):
                ops_module.verify(self.root, A)
            path.unlink()
            path.write_bytes(saved)
        runtime = self.root/'runtime'
        runtime.rename(self.root/'elsewhere')
        runtime.symlink_to('elsewhere', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'real directory'):
            ops_module.verify(self.root, A)

    def test_reject_unexpected_current_target(self):
        self.stage(A)
        current = self.root/'runtime'/'current'
        for target in ('/tmp/' + A, 'versions/../' + A, 'versions/' + A + '/extra'):
            current.symlink_to(target)
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.ops.activate(A)
            current.unlink()
        current.mkdir()
        with self.assertRaisesRegex(ValueError, 'non-symlink'):
            self.ops.activate(A)

    def test_first_activation_accepts_prereveal_and_preserves_private_data(self):
        self.stage(A)
        result = self.ops.activate(A)
        self.assertTrue(result['healthy'])
        self.assertTrue(result['changed'])
        self.assertEqual(result['public_status']['phase'], 'waiting_for_reveal')
        self.assertIsNone(result['public_status']['observed_at_utc'])
        self.assertEqual(ops_module.current(self.root), A)
        self.assertFalse(self.ops.journal.exists())
        self.assertEqual(len(self.docker.mutations()), 1)
        self.assertTrue(self.raw.exists())
        self.assertEqual([path.name for path in self.public.iterdir()], ['status.json'])

    def test_fresh_api_unavailable_heartbeat_is_healthy(self):
        self.stage(A)
        self.docker.phase = 'unavailable'
        self.assertTrue(self.ops.activate(A)['healthy'])

    def test_identical_compiled_hash_is_idempotent_across_source_identifiers(self):
        code = 'export const identical = true;\n'
        self.active(A, code)
        self.stage(B, code)
        result = self.ops.activate(B)
        self.assertFalse(result['changed'])
        self.assertEqual(result['current'], A)
        self.assertEqual(result['requested'], B)
        self.assertFalse(self.docker.mutations())

    def test_failed_activation_rolls_back_without_removing_raw_or_state(self):
        self.active()
        self.stage(B)
        self.docker.fail_versions.add(B)
        with self.assertRaisesRegex(RuntimeError, 'previous collector restored'):
            self.ops.activate(B)
        self.assertEqual(ops_module.current(self.root), A)
        self.assertTrue(self.ops.status()['healthy'])
        self.assertFalse(self.ops.journal.exists())
        self.assertEqual(len(self.docker.mutations()), 2)
        self.assertEqual(json.loads(self.raw.read_text()), {'private_evidence': True})
        self.assertTrue((self.root/'runtime'/'versions'/B).exists())

    def test_first_activation_failure_stops_only_collector(self):
        self.stage(A)
        self.docker.fail_versions.add(A)
        with self.assertRaisesRegex(RuntimeError, 'previous collector restored'):
            self.ops.activate(A)
        self.assertIsNone(ops_module.current(self.root))
        self.assertEqual(self.docker.mutations()[-1][-2:], ['stop', 'collector'])
        self.assertTrue(self.raw.exists())

    def test_interrupted_activation_keeps_intent_and_recovers_before_noop(self):
        self.active()
        self.stage(B)
        self.docker.crash_versions.add(B)
        with self.assertRaises(KeyboardInterrupt):
            self.ops.activate(B)
        self.assertTrue(self.ops.journal.exists())
        self.assertEqual(ops_module.current(self.root), B)
        self.docker.crash_versions.clear()
        result = self.ops.activate(A)
        self.assertFalse(result['changed'])
        self.assertEqual(result['current'], A)
        self.assertFalse(self.ops.journal.exists())
        self.assertEqual(len(self.docker.mutations()), 2)

    def test_pending_before_switch_restarts_previous_to_restore_process_identity(self):
        self.active()
        self.stage(B)
        self.pending()
        self.assertTrue(self.ops.recover_pending())
        self.assertEqual(ops_module.current(self.root), A)
        self.assertEqual(len(self.docker.mutations()), 1)

    def test_unrelated_current_blocks_rollback_and_preserves_journal(self):
        self.active()
        self.stage(B)
        self.stage(C)
        self.pending()
        ops_module.switch(self.root, C)
        with self.assertRaisesRegex(RuntimeError, 'unrelated rollback'):
            self.ops.recover_pending()
        self.assertEqual(ops_module.current(self.root), C)
        self.assertTrue(self.ops.journal.exists())
        self.assertFalse(self.docker.mutations())

    def test_failed_rollback_keeps_recovery_intent_for_retry(self):
        self.active()
        self.stage(B)
        self.docker.fail_versions.update((A, B))
        with self.assertRaisesRegex(RuntimeError, 'rollback pending'):
            self.ops.activate(B)
        self.assertTrue(self.ops.journal.exists())
        self.assertEqual(ops_module.current(self.root), A)
        self.docker.fail_versions.clear()
        self.assertTrue(self.ops.recover_pending())
        self.assertTrue(self.ops.status()['healthy'])
        self.assertFalse(self.ops.journal.exists())

    def test_new_container_cannot_reuse_previous_containers_fresh_status(self):
        self.active()
        self.stage(B)
        self.docker.stale_versions.add(B)
        with self.assertRaisesRegex(RuntimeError, 'fresh healthy heartbeat'):
            self.ops.activate(B)
        self.assertEqual(ops_module.current(self.root), A)

    def test_status_freshness_and_schema(self):
        self.active()
        for change in ({'checked': self.docker.clock - 601}, {'checked': self.docker.clock + 31},
                       {'environment': 'rehearsal'}, {'collected_count': True},
                       {'target_count': 3}, {'phase': ''}, {'last_checked_at_utc': '2026-09-15T00:00:00'}):
            with self.subTest(change=change):
                self.docker.write_status(**change)
                self.assertFalse(self.ops.status()['healthy'])
        self.docker.write_status()
        self.assertTrue(self.ops.status()['healthy'])
        path = self.public/'status.json'
        path.unlink()
        path.symlink_to(self.raw)
        self.assertFalse(self.ops.status()['healthy'])

    def test_collector_private_root_cannot_be_inside_public_site(self):
        nested = self.public.parent/'private'
        (nested/'runtime'/'versions').mkdir(parents=True)
        (nested/'data').mkdir()
        with self.assertRaisesRegex(ValueError, 'outside the public site'):
            ops_module.CollectorOps(nested, self.public, runner=self.docker.run)

    def test_compose_exposes_only_nested_public_mount_and_has_no_ports(self):
        text = (PROJECT/'deployment'/'collector-compose.yaml').read_text()
        self.assertNotIn('ports:', text)
        self.assertNotIn('docker.sock', text)
        self.assertIn('source: /opt/farm-companion/collector/data\n        target: /data', text)
        self.assertIn('source: /opt/farm-companion/site/collection\n        target: /data/public', text)
        self.assertIn('source: /opt/farm-companion/collector/runtime\n        target: /app\n        read_only: true', text)
        self.assertIn('user: "1000:1000"', text)
        self.assertIn('cap_drop: [ALL]', text)
        self.assertIn('read_only: true', text)
        self.assertIn('node:24-alpine@sha256:', text)


if __name__ == '__main__':
    unittest.main()
