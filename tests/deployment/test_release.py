"""Exercise the public release boundary and recovery without SSH or live writes."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("farm_deploy", ROOT / "tools" / "deploy.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
import release_ops


PUBLIC_FILES = {
    "index.html", "app.js", "plan-worker.js", "yield-farm-companion.user.js",
    "farm-companion-chrome.zip", "build.json", "ART-CREDITS.txt",
    "FONT-LICENSES.txt", "INSTALL-CHROME.txt", "README.txt",
}
RELEASE_A = "20260912T120000Z-aaaaaaaaaaaa"
RELEASE_B = "20260912T120100Z-bbbbbbbbbbbb"
RELEASE_C = "20260912T120200Z-cccccccccccc"
RELEASE_D = "20260912T120300Z-dddddddddddd"
SOURCE_HASH = "a" * 64


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.dist = self.root / "dist"
        self.dist.mkdir()
        self.site = self.root / "site"
        (self.site / "releases").mkdir(parents=True)
        for name in PUBLIC_FILES:
            (self.dist / name).write_text("Public fixture: " + name)
        (self.dist / "index.html").write_text(
            '<!doctype html><script type="module" src="./app.js"></script>'
        )
        (self.dist / "build.json").write_text(json.dumps({"version": "2.4.0"}))
        self.write_extension()

    def write_extension(self, extra_member=None):
        with zipfile.ZipFile(self.dist / "farm-companion-chrome.zip", "w") as archive:
            archive.writestr("manifest.json", json.dumps({"manifest_version": 3}))
            archive.writestr("plan-worker.js", "self.onmessage = () => {};")
            if extra_member:
                archive.writestr(extra_member, "Should never be published")

    def stage(self, release_id):
        folder = self.site / "releases" / release_id
        manifest = deploy.stage_release(self.dist, folder, release_id, SOURCE_HASH)
        return folder, manifest

    def local_remote(self, command, *args):
        """Use the real server operations while keeping every read/write in the fixture."""
        if command == "status":
            self.assertEqual(args, ())
            return {"current": release_ops.current(self.site)}
        if command == "activate":
            self.assertEqual(len(args), 1)
            return release_ops.activate(self.site, args[0])
        if command == "rollback":
            self.assertEqual(len(args), 3)
            self.assertEqual(args[1], "--expected")
            return release_ops.rollback(self.site, args[0], args[2])
        self.fail(f"Unexpected remote command: {command}")

    def pending_state(self):
        return {
            "pending_release": RELEASE_B,
            "previous_release": RELEASE_A,
            "last_release": RELEASE_A,
            "last_deployed_hash": SOURCE_HASH,
            "status": "activating",
        }

    def test_staging_only_publishes_the_public_allowlist(self):
        (self.dist / "holdings.json").write_text('{"private": "portfolio"}')
        (self.dist / "_headers").write_text("Host-specific configuration")
        (self.dist / "portfolio").mkdir()
        (self.dist / "portfolio" / "private.json").write_text("Private workspace")

        folder, manifest = self.stage(RELEASE_A)

        self.assertEqual({path.name for path in folder.iterdir()}, PUBLIC_FILES | {"release.json"})
        self.assertEqual(set(manifest["files"]), PUBLIC_FILES)
        self.assertEqual(release_ops.verify(self.site, RELEASE_A), manifest)
        self.assertIn(f'src="/releases/{RELEASE_A}/app.js"', (folder / "index.html").read_text())
        self.assertNotIn('src="./app.js"', (folder / "index.html").read_text())
        build = json.loads((folder / "build.json").read_text())
        self.assertEqual(build["release_id"], RELEASE_A)
        self.assertEqual(build["source_sha256"], SOURCE_HASH)
        self.assertEqual(build["version"], "2.4.0")

    def test_payload_remains_publicly_readable_with_private_watcher_umask(self):
        previous_umask = os.umask(0o077)
        try:
            folder, _ = self.stage(RELEASE_A)
        finally:
            os.umask(previous_umask)

        self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o755)
        for path in folder.iterdir():
            with self.subTest(file=path.name):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        release_ops.verify(self.site, RELEASE_A)

    def test_changed_checksum_cannot_replace_current_release(self):
        first, _ = self.stage(RELEASE_A)
        release_ops.activate(self.site, RELEASE_A)
        second, _ = self.stage(RELEASE_B)
        (second / "plan-worker.js").write_text("Corrupted worker after upload")

        with self.assertRaisesRegex(ValueError, "Checksum mismatch: plan-worker.js"):
            release_ops.activate(self.site, RELEASE_B)

        self.assertEqual(release_ops.current(self.site), RELEASE_A)
        self.assertEqual((self.site / "current").resolve(), first)
        release_ops.verify(self.site, RELEASE_A)

    def test_verification_rejects_unlisted_server_files(self):
        folder, _ = self.stage(RELEASE_A)
        (folder / "holdings.json").write_text("Private workspace")

        with self.assertRaisesRegex(ValueError, "Unexpected or missing release files"):
            release_ops.verify(self.site, RELEASE_A)

    def test_rollback_refuses_to_revert_a_different_current_release(self):
        self.stage(RELEASE_A)
        self.stage(RELEASE_B)
        self.stage(RELEASE_C)
        release_ops.activate(self.site, RELEASE_A)
        release_ops.activate(self.site, RELEASE_B)
        release_ops.activate(self.site, RELEASE_C)

        with self.assertRaisesRegex(ValueError, "Current release changed"):
            release_ops.rollback(self.site, RELEASE_A, RELEASE_B)

        self.assertEqual(release_ops.current(self.site), RELEASE_C)

    def test_rollback_restores_verified_previous_release_and_retains_assets(self):
        first, _ = self.stage(RELEASE_A)
        release_ops.activate(self.site, RELEASE_A)
        (self.dist / "app.js").write_text("Different UI bundle")
        second, _ = self.stage(RELEASE_B)
        activated = release_ops.activate(self.site, RELEASE_B)
        self.assertEqual(activated, {"current": RELEASE_B, "previous": RELEASE_A})

        result = release_ops.rollback(self.site, activated["previous"], RELEASE_B)

        self.assertEqual(result, {"current": RELEASE_A, "previous": RELEASE_B})
        self.assertEqual((self.site / "current").resolve(), first)
        self.assertTrue((second / "app.js").is_file())
        self.assertNotEqual((first / "app.js").read_bytes(), (second / "app.js").read_bytes())
        release_ops.verify(self.site, RELEASE_A)
        release_ops.verify(self.site, RELEASE_B)

    def test_rollback_without_previous_release_removes_only_the_current_link(self):
        folder, _ = self.stage(RELEASE_A)
        release_ops.activate(self.site, RELEASE_A)

        result = release_ops.rollback(self.site, "none", RELEASE_A)

        self.assertIsNone(result["current"])
        self.assertIsNone(release_ops.current(self.site))
        self.assertTrue(folder.is_dir())

    def test_recovery_restores_previous_after_activation_response_is_lost(self):
        self.stage(RELEASE_A)
        self.stage(RELEASE_B)
        release_ops.activate(self.site, RELEASE_A)
        state = self.pending_state()

        def lose_activation_response(command, *args):
            result = self.local_remote(command, *args)
            if command == "activate":
                raise ConnectionError("SSH disconnected after the server switched")
            return result

        with mock.patch.object(deploy, "STATE_DIR", self.root / "state"), \
                mock.patch.object(deploy, "remote", side_effect=lose_activation_response) as remote:
            deploy.save_state(state)
            with self.assertRaises(ConnectionError):
                deploy.remote("activate", RELEASE_B)
            self.assertEqual(release_ops.current(self.site), RELEASE_B)
            self.assertEqual(deploy.load_state()["pending_release"], RELEASE_B)

            # Restart from disk, without an activation response in memory.
            restarted = deploy.load_state()
            deploy.recover_pending(restarted)

            self.assertEqual(release_ops.current(self.site), RELEASE_A)
            self.assertIsNone(restarted["pending_release"])
            self.assertIsNone(deploy.load_state()["pending_release"])
            self.assertEqual(deploy.load_state()["status"], "recovered")
            self.assertEqual(remote.call_args_list, [
                mock.call("activate", RELEASE_B), mock.call("status"),
                mock.call("rollback", RELEASE_A, "--expected", RELEASE_B),
            ])

    def test_recovery_clears_intent_when_activation_never_reached_server(self):
        self.stage(RELEASE_A)
        self.stage(RELEASE_B)
        release_ops.activate(self.site, RELEASE_A)
        state = self.pending_state()

        with mock.patch.object(deploy, "STATE_DIR", self.root / "state"), \
                mock.patch.object(deploy, "remote", side_effect=self.local_remote) as remote:
            deploy.save_state(state)
            deploy.recover_pending(state)

            remote.assert_called_once_with("status")
            self.assertEqual(release_ops.current(self.site), RELEASE_A)
            self.assertIsNone(deploy.load_state()["pending_release"])
            self.assertEqual(state["status"], "recovered")

    def test_recovery_does_not_rollback_an_unrelated_current_release(self):
        self.stage(RELEASE_A)
        self.stage(RELEASE_B)
        self.stage(RELEASE_C)
        release_ops.activate(self.site, RELEASE_C)
        state = self.pending_state()

        with mock.patch.object(deploy, "STATE_DIR", self.root / "state"), \
                mock.patch.object(deploy, "remote", side_effect=self.local_remote) as remote:
            deploy.save_state(state)
            with self.assertRaisesRegex(RuntimeError, "refusing to roll back another release"):
                deploy.recover_pending(state)

            remote.assert_called_once_with("status")
            self.assertEqual(release_ops.current(self.site), RELEASE_C)
            self.assertEqual(state["pending_release"], RELEASE_B)
            self.assertEqual(deploy.load_state(), self.pending_state())

    def test_recovery_keeps_pending_intent_when_rollback_connection_fails(self):
        self.stage(RELEASE_A)
        self.stage(RELEASE_B)
        release_ops.activate(self.site, RELEASE_B)
        state = self.pending_state()

        def disconnected_rollback(command, *args):
            if command == "rollback":
                raise ConnectionError("SSH unavailable before rollback")
            return self.local_remote(command, *args)

        with mock.patch.object(deploy, "STATE_DIR", self.root / "state"), \
                mock.patch.object(deploy, "remote", side_effect=disconnected_rollback) as remote:
            deploy.save_state(state)
            with self.assertRaises(ConnectionError):
                deploy.recover_pending(state)

            self.assertEqual(release_ops.current(self.site), RELEASE_B)
            self.assertEqual(state["pending_release"], RELEASE_B)
            self.assertEqual(deploy.load_state(), self.pending_state())
            self.assertEqual(remote.call_args_list, [
                mock.call("status"), mock.call("rollback", RELEASE_A, "--expected", RELEASE_B),
            ])

            # A later timer invocation can recover the unchanged durable intent.
            remote.side_effect = self.local_remote
            deploy.recover_pending(deploy.load_state())
            self.assertEqual(release_ops.current(self.site), RELEASE_A)
            self.assertIsNone(deploy.load_state()["pending_release"])

    def test_auto_recovers_before_unchanged_source_can_return_early(self):
        self.stage(RELEASE_A)
        self.stage(RELEASE_B)
        release_ops.activate(self.site, RELEASE_B)
        state = self.pending_state()

        def unchanged_fingerprint(_root):
            # Checking the source before recovery would leave the bad release live.
            self.assertEqual(release_ops.current(self.site), RELEASE_A)
            self.assertIsNone(state["pending_release"])
            return SOURCE_HASH

        with mock.patch.object(deploy, "STATE_DIR", self.root / "state"), \
                mock.patch.object(deploy, "load_state", return_value=state), \
                mock.patch.object(deploy, "remote", side_effect=self.local_remote) as remote, \
                mock.patch.object(deploy, "fingerprint", side_effect=unchanged_fingerprint), \
                mock.patch.object(deploy, "deploy") as publish, \
                mock.patch.object(deploy.sys, "argv", ["deploy.py", "--auto"]):
            deploy.main()

            publish.assert_not_called()
            self.assertEqual(remote.call_args_list, [
                mock.call("status"), mock.call("rollback", RELEASE_A, "--expected", RELEASE_B),
            ])
            saved = json.loads((deploy.STATE_DIR / "status.json").read_text())
            self.assertIsNone(saved["pending_release"])
            self.assertEqual(saved["status"], "recovered")

    def test_extension_reserved_and_unsafe_members_are_rejected(self):
        for index, member in enumerate(("_headers", "assets/_private.js", "../secret", "/secret")):
            with self.subTest(member=member):
                self.write_extension(member)
                with self.assertRaisesRegex(ValueError, "Reserved or unsafe extension path"):
                    deploy.stage_release(self.dist, self.root / f"rejected-{index}", RELEASE_A, SOURCE_HASH)

    def test_public_file_symlink_is_not_staged(self):
        private = self.root / "private.json"
        private.write_text("Private workspace")
        (self.dist / "app.js").unlink()
        (self.dist / "app.js").symlink_to(private)

        with self.assertRaisesRegex(ValueError, "Missing regular public file: app.js"):
            self.stage(RELEASE_A)

    def test_prune_preserves_current_and_recent_releases(self):
        for release_id in (RELEASE_A, RELEASE_B, RELEASE_C, RELEASE_D):
            self.stage(release_id)
        release_ops.activate(self.site, RELEASE_A)
        unrelated = self.site / "releases" / "operator-notes"
        unrelated.mkdir()

        release_ops.prune(self.site, keep=2)

        self.assertEqual(
            {path.name for path in (self.site / "releases").iterdir()},
            {RELEASE_A, RELEASE_C, RELEASE_D, "operator-notes"},
        )
        self.assertEqual(release_ops.current(self.site), RELEASE_A)
        self.assertTrue(unrelated.is_dir())
        release_ops.verify(self.site, RELEASE_A)

    def test_fingerprint_ignores_private_holdings_and_detects_source_changes(self):
        source = self.root / "workspace"
        (source / "src").mkdir(parents=True)
        (source / "src" / "dashboard.js").write_text("export const theme = 'forest';")
        (source / "portfolio").mkdir()
        holdings = source / "portfolio" / "holdings.json"
        holdings.write_text('{"wallets": []}')
        baseline = deploy.fingerprint(source)

        holdings.write_text('{"wallets": [{"private": "local holdings"}]}')
        (source / "portfolio" / "other-private.json").write_text("Private workspace")

        self.assertEqual(deploy.fingerprint(source), baseline)
        self.assertNotIn(Path("portfolio/holdings.json"), deploy.inputs(source))
        (source / "src" / "dashboard.js").write_text("export const theme = 'winter';")
        self.assertNotEqual(deploy.fingerprint(source), baseline)


if __name__ == "__main__":
    unittest.main()
