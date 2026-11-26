"""Select an audited AMIS publication receipt; never build, publish or pull images."""
import argparse
import json
from pathlib import Path
import re
import subprocess

REPOSITORY = 'ai-specs/kestra-plugin-amis-apps'
HOST = r'ghcr\.io/ai-specs/kestra-overlay@sha256:[a-f0-9]{64}'
IMAGE = r'ghcr\.io/ai-specs/kestra-plugin-amis-apps-artifact@sha256:[a-f0-9]{64}'


def redact(text):
    text = re.sub(r'(?i)(bearer\s+)[^\s"\']+', r'\1[REDACTED]', text)
    text = re.sub(r'(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)', '[REDACTED]', text)
    return re.sub(r'(?i)((?:token|password|secret|authorization)\s*[:=]\s*)[^\s,;]+', r'\1[REDACTED]', text)


def gh_transport(args):
    result = subprocess.run(['gh', *args], capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(redact(result.stderr))
    return result.stdout


def select_release(commit, host_image, output, transport=gh_transport):
    assert re.fullmatch(r'[a-f0-9]{40}', commit), 'Exact gitlink commit required'
    assert re.fullmatch(HOST, host_image), 'Explicit immutable host image required'
    output = Path(output).absolute()
    assert output.parent.resolve() == output.parent, 'Symlink output parent forbidden'
    output.mkdir(mode=0o700)  # Fail if an earlier download exists.

    def api(path):
        return json.loads(transport(['api', path]))

    def pages(path, key):
        found = []
        for page in range(1, 1001):
            separator = '&' if '?' in path else '?'
            response = api(f'{path}{separator}per_page=100&page={page}')
            rows = response[key]
            found.extend(rows)
            if len(found) >= response.get('total_count', len(found)) or len(rows) < 100:
                return found
        raise AssertionError('API pagination limit exceeded')

    def valid_run(run, workflow, event):
        return (run.get('head_sha') == commit and run.get('head_branch') == 'main'
                and run.get('status') == 'completed' and run.get('conclusion') == 'success'
                and run.get('head_repository', {}).get('full_name') == REPOSITORY
                and run.get('event') == event and run.get('path') == workflow)

    try:
        runs = pages(f'repos/{REPOSITORY}/actions/runs?head_sha={commit}', 'workflow_runs')
        sources = {str(run['id']): run for run in runs
                   if valid_run(run, '.github/workflows/foundation.yml', 'push')}
        assert sources, 'No completed successful push/main source CI for gitlink'
        publishers = [run for run in runs if valid_run(run, '.github/workflows/publish.yml', 'workflow_run')]
        assert publishers, 'No completed successful workflow_run publisher for gitlink'
        # A rerun can publish the same commit again. Audit the newest successful
        # publisher, never merge artifacts from historical publishers.
        publisher = max(publishers, key=lambda run: int(run['id']))
        artifact_name = f'amis-publication-{commit}'
        artifacts = pages(f'repos/{REPOSITORY}/actions/runs/{publisher["id"]}/artifacts', 'artifacts')
        candidates = [artifact for artifact in artifacts if artifact.get('name') == artifact_name]
        assert len(candidates) == 1, 'Exactly one publication artifact required in latest successful publisher'
        artifact = candidates[0]
        assert artifact.get('expired') is False, 'Publication artifact expired'
        metadata = artifact.get('workflow_run', {})
        assert metadata.get('head_sha') == commit and str(metadata.get('id')) == str(publisher['id']), 'Artifact run/head mismatch'
        destination = output / 'publication'
        transport(['run', 'download', str(publisher['id']), '--repo', REPOSITORY,
                   '--name', artifact_name, '--dir', str(destination)])

        def downloaded(name):
            matches = list(destination.rglob(name))
            assert len(matches) == 1, f'Exactly one {name} required'
            path = matches[0]
            assert not path.is_symlink() and path.resolve().is_relative_to(destination.resolve()), 'Unsafe downloaded evidence path'
            return json.loads(path.read_text())

        receipt = downloaded('publication-receipt.json')
        provenance = downloaded('release-provenance.json')
        assert receipt.get('sourceCommit') == commit, 'Receipt source commit mismatch'
        assert str(receipt.get('publisherRunId')) == str(publisher['id']), 'Receipt publisher run mismatch'
        source = receipt.get('sourceCi', {})
        assert str(source.get('runId')) in sources, 'Receipt source CI run mismatch'
        for key, expected in {'headSha': commit, 'status': 'completed', 'conclusion': 'success', 'event': 'push', 'branch': 'main'}.items():
            assert source.get(key) == expected, f'Receipt source CI {key} mismatch'
        assert re.fullmatch(IMAGE, receipt.get('image', '')), 'Immutable AMIS artifact image required'
        assert re.fullmatch(r'[a-f0-9]{64}', receipt.get('jarSha256', '')), 'Invalid jar SHA-256'
        assert provenance.get('repository') == REPOSITORY and provenance.get('commit') == commit, 'Provenance source mismatch'
        assert provenance.get('sourceCi') == source, 'Provenance source CI mismatch'
        assert str(provenance.get('runId')) == str(publisher['id']), 'Provenance publisher mismatch'
        assert provenance.get('jarSha256') == receipt['jarSha256'], 'Provenance jar mismatch'
        assert provenance.get('host', {}).get('image') == host_image, 'Compilation host image mismatch'
        selection = {'repository': REPOSITORY, 'headSha': commit, 'sourceRunId': sources[str(source['runId'])]['id'],
                     'publisherRunId': publisher['id'], 'artifactId': artifact['id'], 'artifactName': artifact_name,
                     'artifactHeadSha': metadata['head_sha'], 'image': receipt['image'],
                     'jarSha256': receipt['jarSha256'], 'hostImage': host_image,
                     'receipt': str(next(destination.rglob('publication-receipt.json')).relative_to(output)),
                     'provenance': str(next(destination.rglob('release-provenance.json')).relative_to(output))}
        (output / 'release-selection.json').write_text(json.dumps(selection, indent=2) + '\n')
        return selection
    except Exception as failure:
        (output / 'selection-failure.log').write_text(redact(str(failure)) + '\n')
        raise RuntimeError(redact(str(failure))) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit40', required=True)
    parser.add_argument('--host-image', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(select_release(args.commit40, args.host_image, args.output)))
    except (AssertionError, RuntimeError, OSError) as failure:
        parser.exit(1, redact(str(failure)) + '\n')


if __name__ == '__main__':
    main()
