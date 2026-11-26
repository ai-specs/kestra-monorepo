"""Synthetic GitHub transport data only; these tests do not select a real release."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('amis_selection', Path(__file__).parents[1] / 'select-amis-apps-release.py')
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)

COMMIT = 'a' * 40
HOST = 'ghcr.io/ai-specs/kestra-overlay@sha256:' + 'b' * 64


class Transport:
    def __init__(self):
        self.source = {'id': 10, 'head_sha': COMMIT, 'head_branch': 'main', 'status': 'completed',
                       'head_repository': {'id': 123, 'name': 'kestra-plugin-amis-apps', 'full_name': selection.REPOSITORY},
                       'conclusion': 'success', 'event': 'push', 'path': '.github/workflows/foundation.yml'}
        self.publisher = {**self.source, 'id': 20, 'event': 'workflow_run', 'path': '.github/workflows/publish.yml'}
        self.artifact = {'id': 30, 'name': 'amis-publication-' + COMMIT, 'expired': False,
                         'workflow_run': {'id': 20, 'head_sha': COMMIT}}
        self.artifacts = [self.artifact]
        source_ci = {'runId': 10, 'headSha': COMMIT, 'status': 'completed', 'conclusion': 'success', 'event': 'push', 'branch': 'main'}
        self.receipt = {'image': 'ghcr.io/ai-specs/kestra-plugin-amis-apps-artifact@sha256:' + 'c' * 64,
                        'sourceCommit': COMMIT, 'sourceCi': source_ci, 'jarSha256': 'd' * 64, 'publisherRunId': '20'}
        self.provenance = {'repository': selection.REPOSITORY, 'commit': COMMIT, 'sourceCi': copy.deepcopy(source_ci),
                           'jarSha256': 'd' * 64, 'host': {'image': HOST}, 'runId': '20'}
        self.calls = []
        self.historical_runs = []

    def __call__(self, args):
        self.calls.append(args)
        if args[0] == 'api':
            if '/artifacts?' in args[1]:
                return json.dumps({'total_count': len(self.artifacts), 'artifacts': self.artifacts})
            runs = [self.source, self.publisher, *self.historical_runs]
            return json.dumps({'total_count': len(runs), 'workflow_runs': runs})
        assert args[:2] == ['run', 'download']
        output = Path(args[args.index('--dir') + 1])
        output.mkdir()
        (output / 'publication-receipt.json').write_text(json.dumps(self.receipt))
        provenance_directory = output / 'release-image/release'
        provenance_directory.mkdir(parents=True)
        (provenance_directory / 'release-provenance.json').write_text(json.dumps(self.provenance))
        return ''


class ReleaseSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name).resolve()
        self.transport = Transport()

    def run_selection(self, name='run'):
        return selection.select_release(COMMIT, HOST, self.parent / name, self.transport)

    def test_exact_successful_chain_downloads_and_records_actual_metadata(self):
        result = self.run_selection()
        self.assertEqual((result['sourceRunId'], result['publisherRunId'], result['artifactId']), (10, 20, 30))
        self.assertEqual(result['hostImage'], HOST)
        self.assertEqual(result['headSha'], COMMIT)
        self.assertEqual(result['receipt'], 'publication/publication-receipt.json')
        self.assertEqual(result['provenance'], 'publication/release-image/release/release-provenance.json')
        self.assertEqual(json.loads((self.parent / 'run/release-selection.json').read_text()), result)
        downloads = [args for args in self.transport.calls if args[0] == 'run']
        self.assertEqual(len(downloads), 1)
        self.assertEqual(downloads[0][2], '20')

    def test_wrong_source_head_or_unsuccessful_source_is_rejected_before_download(self):
        for index, change in enumerate([{'head_sha': 'e' * 40}, {'conclusion': 'failure'}, {'status': 'in_progress'},
                                        {'event': 'pull_request'}, {'head_branch': 'other'}, {'path': '.github/workflows/other.yml'}]):
            self.transport = Transport()
            self.transport.source.update(change)
            with self.assertRaises(RuntimeError):
                self.run_selection(str(index))
            self.assertFalse(any(args[0] == 'run' for args in self.transport.calls))

    def test_latest_successful_publisher_selected_without_mixing_historical_artifacts(self):
        self.transport.historical_runs = [dict(self.transport.publisher, id=19),
                                          dict(self.transport.publisher, id=21, conclusion='failure')]
        result = self.run_selection()
        self.assertEqual(result['publisherRunId'], 20)
        artifact_queries = [args[1] for args in self.transport.calls if args[0] == 'api' and '/artifacts?' in args[1]]
        self.assertEqual(len(artifact_queries), 1)
        self.assertIn('/runs/20/artifacts?', artifact_queries[0])

    def test_foreign_or_missing_head_repository_rejected_for_source_and_publisher(self):
        for index, (run, repository) in enumerate([
            ('source', None), ('source', {'full_name': 'other/kestra-plugin-amis-apps'}),
            ('publisher', None), ('publisher', {'full_name': 'other/kestra-plugin-amis-apps'})
        ]):
            self.transport = Transport()
            target = getattr(self.transport, run)
            if repository is None:
                del target['head_repository']
            else:
                target['head_repository'] = repository
            with self.assertRaises(RuntimeError):
                self.run_selection(str(index))

    def test_wrong_publisher_event_head_or_path_is_rejected(self):
        for index, change in enumerate([{'event': 'push'}, {'head_sha': 'f' * 40}, {'conclusion': 'failure'},
                                        {'path': '.github/workflows/other.yml'}]):
            self.transport = Transport()
            self.transport.publisher.update(change)
            with self.assertRaises(RuntimeError):
                self.run_selection(str(index))

    def test_multiple_expired_and_wrong_metadata_artifacts_are_rejected(self):
        for index, mutate in enumerate([
            lambda transport: transport.artifacts.append(copy.deepcopy(transport.artifact)),
            lambda transport: transport.artifact.update(expired=True),
            lambda transport: transport.artifact['workflow_run'].update(head_sha='e' * 40),
            lambda transport: transport.artifact['workflow_run'].update(id=99),
        ]):
            self.transport = Transport()
            mutate(self.transport)
            with self.assertRaises(RuntimeError):
                self.run_selection(str(index))

    def test_wrong_receipt_source_ci_run_host_image_and_hash_fail(self):
        mutations = [
            lambda t: t.receipt.update(sourceCommit='e' * 40),
            lambda t: t.receipt.update(publisherRunId='21'),
            lambda t: t.receipt['sourceCi'].update(runId=99),
            lambda t: t.receipt['sourceCi'].update(headSha='e' * 40),
            lambda t: t.receipt['sourceCi'].update(status='in_progress'),
            lambda t: t.receipt['sourceCi'].update(conclusion='failure'),
            lambda t: t.receipt['sourceCi'].update(event='pull_request'),
            lambda t: t.receipt['sourceCi'].update(branch='other'),
            lambda t: t.provenance['host'].update(image='wrong'),
            lambda t: t.receipt.update(image='ghcr.io/other@sha256:' + 'e' * 64),
            lambda t: t.receipt.update(jarSha256='bad'),
            lambda t: t.provenance.update(jarSha256='e' * 64),
            lambda t: t.provenance.update(runId=99),
        ]
        for index, mutate in enumerate(mutations):
            self.transport = Transport()
            mutate(self.transport)
            with self.assertRaises(RuntimeError):
                self.run_selection(str(index))
            self.assertTrue((self.parent / str(index) / 'selection-failure.log').is_file())
            self.assertFalse((self.parent / str(index) / 'release-selection.json').exists())

    def test_output_must_be_new_and_input_commit_and_host_explicit(self):
        self.run_selection()
        with self.assertRaises(FileExistsError):
            self.run_selection()
        for commit, host in [('short', HOST), (COMMIT, 'latest')]:
            with self.assertRaises(AssertionError):
                selection.select_release(commit, host, self.parent / 'invalid', self.transport)

    def test_network_failure_is_redacted_and_never_retried(self):
        calls = []
        def failure(args):
            calls.append(args)
            raise RuntimeError('Authorization: Bearer ghp_syntheticCredential token=syntheticSecret')
        with self.assertRaises(RuntimeError):
            selection.select_release(COMMIT, HOST, self.parent / 'failure', failure)
        text = (self.parent / 'failure/selection-failure.log').read_text()
        self.assertNotIn('syntheticCredential', text)
        self.assertNotIn('syntheticSecret', text)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
