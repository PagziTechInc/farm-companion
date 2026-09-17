"""Check collector staging and publication order without SSH or Docker."""
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('farm_deploy_collector', ROOT/'tools'/'deploy.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
SOURCE_HASH = 'a' * 64
PREVIOUS = '20260912T120000Z-bbbbbbbbbbbb'


class CollectorIntegrationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.snapshot = self.root/'source'
        self.artifact = self.snapshot/'dist-collector'/'collector.mjs'
        self.artifact.parent.mkdir(parents=True)
        self.code = b'console.log("Public production collector");\n'
        self.artifact.write_bytes(self.code)
        self.digest = hashlib.sha256(self.code).hexdigest()
        self.state_dir = self.root/'state'
        self.state_dir.mkdir()
        self.commands = []

    def success_run(self, command, **kwargs):
        self.commands.append(command)
        return subprocess.CompletedProcess(command, 0, json.dumps({
            'healthy': True, 'code_sha256': self.digest, 'pending_activation': False}), '')

    def test_state_intent_is_synced_before_replace_and_directory_after_replace(self):
        previous = {'pending_collector': False}
        updated = {'pending_collector': True, 'last_deployed_hash': SOURCE_HASH}
        path = self.state_dir/'status.json'
        path.write_text(json.dumps(previous))
        events = []
        real_fsync, real_replace = os.fsync, os.replace
        def fsync(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                events.append('sync-directory')
                self.assertEqual(json.loads(path.read_text()), updated)
            else:
                events.append('sync-file')
                self.assertEqual(json.loads(path.read_text()), previous)
                self.assertEqual(json.loads(path.with_suffix('.tmp').read_text()), updated)
            real_fsync(fd)
        def replace(source, target):
            self.assertEqual(events, ['sync-file'])
            events.append('replace')
            real_replace(source, target)
        with mock.patch.object(deploy, 'STATE_DIR', self.state_dir), \
                mock.patch.object(deploy.os, 'fsync', side_effect=fsync), \
                mock.patch.object(deploy.os, 'replace', side_effect=replace):
            deploy.save_state(updated)
        self.assertEqual(events, ['sync-file', 'replace', 'sync-directory'])
        self.assertEqual(json.loads(path.read_text()), updated)
        self.assertFalse(path.with_suffix('.tmp').exists())

    def test_collector_staging_modes_and_allowlist_under_private_umask(self):
        (self.artifact.parent/'wallets.json').write_text('Private source, never staged')
        previous = os.umask(0o077)
        try:
            with mock.patch.object(deploy, 'run', side_effect=self.success_run):
                self.assertEqual(deploy.deploy_collector(self.snapshot, self.root), self.digest)
        finally:
            os.umask(previous)
        staged = self.root/'collector'
        self.assertEqual({path.name for path in staged.iterdir()}, {'collector.mjs', 'manifest.json'})
        self.assertEqual(stat.S_IMODE(staged.stat().st_mode), 0o755)
        for path in staged.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        self.assertEqual((staged/'collector.mjs').read_bytes(), self.code)
        self.assertEqual(json.loads((staged/'manifest.json').read_text())['sha256'], self.digest)
        rsync = next(command for command in self.commands if command[0] == 'rsync')
        self.assertEqual(rsync[-1], f'{deploy.SSH_HOST}:/opt/farm-companion/collector/runtime/versions/{self.digest}/')
        self.assertEqual(self.commands[-1][-3:], ['/opt/farm-companion/collector/collector_ops.py', 'activate', self.digest])
        self.assertNotIn('/site/', rsync[-1])

    def test_invalid_empty_private_and_oversize_artifacts_never_reach_ssh(self):
        for case in ('empty', 'private', 'oversize'):
            with self.subTest(case=case), mock.patch.object(deploy, 'run') as run, mock.patch.object(deploy, 'PRIVATE_ADDRESSES', re.compile(b'1' * 40)):
                if case == 'empty': self.artifact.write_bytes(b'')
                elif case == 'private': self.artifact.write_text('0x1111111111111111111111111111111111111111')
                else:
                    with self.artifact.open('wb') as stream:
                        stream.truncate(32 * 1024 * 1024 + 1)
                with self.assertRaises(ValueError):
                    deploy.deploy_collector(self.snapshot, self.root)
                run.assert_not_called()

    def test_symlink_file_and_symlink_dist_directory_are_rejected(self):
        private = self.root/'private.mjs'
        private.write_bytes(self.code)
        self.artifact.unlink()
        self.artifact.symlink_to(private)
        with mock.patch.object(deploy, 'run') as run, self.assertRaises(ValueError):
            deploy.deploy_collector(self.snapshot, self.root)
        run.assert_not_called()
        self.artifact.unlink()
        self.artifact.parent.rmdir()
        external = self.root/'external'
        external.mkdir()
        (external/'collector.mjs').write_bytes(self.code)
        self.artifact.parent.symlink_to(external, target_is_directory=True)
        with mock.patch.object(deploy, 'run') as run, self.assertRaises(ValueError):
            deploy.deploy_collector(self.snapshot, self.root)
        run.assert_not_called()

    def test_invalid_activation_outcomes_fail_closed(self):
        outcomes = ({'healthy': False, 'code_sha256': self.digest},
                    {'healthy': 'yes', 'code_sha256': self.digest},
                    {'healthy': True, 'code_sha256': SOURCE_HASH}, {}, [])
        for index, outcome in enumerate(outcomes):
            scratch = self.root/f'case-{index}'
            scratch.mkdir()
            with self.subTest(outcome=outcome), mock.patch.object(deploy, 'run', return_value=
                    subprocess.CompletedProcess([], 0, json.dumps(outcome), '')):
                with self.assertRaisesRegex(RuntimeError, 'artifact and heartbeat'):
                    deploy.deploy_collector(self.snapshot, scratch)

    def test_recovery_keeps_intent_when_response_lost_then_clears_on_retry(self):
        state = {'pending_collector': True}
        with mock.patch.object(deploy, 'STATE_DIR', self.state_dir), \
                mock.patch.object(deploy, 'run', side_effect=ConnectionError('SSH lost')) as run:
            deploy.save_state(state)
            with self.assertRaises(ConnectionError):
                deploy.recover_collector_pending(state)
            self.assertTrue(deploy.load_state()['pending_collector'])
            run.side_effect = None
            run.return_value = subprocess.CompletedProcess([], 0,
                json.dumps({'pending_activation': False, 'healthy': False, 'current': None}), '')
            deploy.recover_collector_pending(state)
            self.assertFalse(deploy.load_state()['pending_collector'])
            self.assertEqual(run.call_args.args[0][-1], 'recover')

    def test_malformed_or_still_pending_recovery_preserves_intent(self):
        for outcome in ({}, [], {'pending_activation': True}):
            state = {'pending_collector': True}
            with self.subTest(outcome=outcome), mock.patch.object(deploy, 'STATE_DIR', self.state_dir), \
                    mock.patch.object(deploy, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(outcome), '')):
                deploy.save_state(state)
                with self.assertRaises(RuntimeError):
                    deploy.recover_collector_pending(state)
                self.assertTrue(deploy.load_state()['pending_collector'])

    def test_main_recovers_collector_before_unchanged_source_shortcut(self):
        state = {'pending_collector': True, 'last_deployed_hash': SOURCE_HASH}
        def fingerprint(_root):
            self.assertFalse(deploy.load_state()['pending_collector'])
            return SOURCE_HASH
        with mock.patch.object(deploy, 'STATE_DIR', self.state_dir), \
                mock.patch.object(deploy, 'fingerprint', side_effect=fingerprint), \
                mock.patch.object(deploy, 'run', side_effect=self.success_run), \
                mock.patch.object(deploy, 'deploy') as publish, \
                mock.patch.object(deploy.sys, 'argv', ['deploy.py', '--auto']):
            deploy.save_state(state)
            deploy.main()
            publish.assert_not_called()
            self.assertEqual(len(self.commands), 1)
            self.assertEqual(self.commands[0][-1], 'recover')

    def deployment_mocks(self, collector_result=None, collector_error=None):
        events = []
        def collector(snapshot, scratch):
            events.append('collector')
            self.assertTrue(deploy.load_state()['pending_collector'])
            if collector_error: raise collector_error
            return collector_result or self.digest
        def remote(command, *arguments):
            events.append(command)
            if command == 'status': return {'current': PREVIOUS}
            if command == 'activate':
                self.assertFalse(deploy.load_state()['pending_collector'])
                self.assertEqual(deploy.load_state()['collector_sha256'], self.digest)
                return {'previous': PREVIOUS, 'current': arguments[0]}
            return {}
        patches = [mock.patch.object(deploy, 'STATE_DIR', self.state_dir),
                   mock.patch.object(deploy, 'inputs', return_value=[]),
                   mock.patch.object(deploy, 'fingerprint', return_value=SOURCE_HASH),
                   mock.patch.object(deploy, 'stage_release', return_value={'files': {}}),
                   mock.patch.object(deploy, 'health_check'),
                   mock.patch.object(deploy, 'run', side_effect=lambda command, **kwargs: events.append(command[0])),
                   mock.patch.object(deploy, 'deploy_collector', side_effect=collector),
                   mock.patch.object(deploy, 'remote', side_effect=remote)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        return events

    def test_collector_verifies_before_website_activation_and_live_state(self):
        events = self.deployment_mocks()
        state = {}
        deploy.deploy(SOURCE_HASH, state)
        self.assertLess(events.index('rsync'), events.index('collector'))
        self.assertLess(events.index('collector'), events.index('activate'))
        self.assertEqual(state['status'], 'live')
        self.assertEqual(state['collector_sha256'], self.digest)
        self.assertFalse(deploy.load_state()['pending_collector'])

    def test_interrupted_collector_keeps_durable_intent_and_never_activates_web(self):
        events = self.deployment_mocks(collector_error=KeyboardInterrupt('lost process'))
        with self.assertRaises(KeyboardInterrupt):
            deploy.deploy(SOURCE_HASH, {})
        self.assertNotIn('activate', events)
        self.assertTrue(deploy.load_state()['pending_collector'])
        self.assertNotIn('last_deployed_hash', deploy.load_state())


if __name__ == '__main__':
    unittest.main()
