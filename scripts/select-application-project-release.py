"""Download a successful independent plugin release matching the root gitlinks."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def api(path):
    return json.loads(command('gh', 'api', path))


root = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
evidence = {}
for name, repository in [('overlay', 'kestra-overlay'), ('plugin', 'kestra-plugin-rbac')]:
    assert Path(command('git', '-C', str(root / repository), 'rev-parse', '--show-toplevel')).resolve() == (root / repository).resolve(), 'Independent submodule checkout required'
    commit = command('git', '-C', str(root / repository), 'rev-parse', 'HEAD')
    runs = api(f'repos/ai-specs/{repository}/actions/runs?head_sha={commit}&status=success&per_page=100')['workflow_runs']
    runs = [run for run in runs if run['head_sha'] == commit and run['event'] == 'push'
            and run['head_branch'] == 'main' and run['conclusion'] == 'success']
    assert runs, f'No successful published {name} CI for gitlink {commit}; inspect the actual failed run'
    run = max(runs, key=lambda item: item['id'])
    evidence[name + 'RunId'] = run['id']
    if name == 'plugin':
        artifacts = api(f'repos/ai-specs/{repository}/actions/runs/{run["id"]}/artifacts?per_page=100')['artifacts']
        artifacts = [item for item in artifacts if item['name'] == 'kestra-rbac-authorizer' and not item['expired']]
        assert len(artifacts) == 1, 'Exactly one nonexpired plugin artifact required'
        evidence['pluginArtifactId'] = artifacts[0]['id']
        destination = output / 'plugin-artifact'
        assert not destination.exists(), 'Do not reuse an earlier plugin artifact download'
        command('gh', 'run', 'download', str(run['id']), '-R', f'ai-specs/{repository}',
                '--name', 'kestra-rbac-authorizer', '--dir', str(destination))
        jar = destination / 'build/libs/kestra-rbac-authorizer.jar'
        evidence['jarSha256'] = hashlib.sha256(jar.read_bytes()).hexdigest()
        provenance = json.loads((destination / '.integration/host-provenance.json').read_text())
        image = (output / 'image').read_text().strip()
        assert provenance['image'] == image, 'Published plugin compilation image differs from deployment'
        for directory in ['.evidence/unit/results', '.evidence/postgres/results']:
            assert list((destination / directory).glob('*.xml')), f'Missing downloaded {directory}'
        command(sys.executable, str(root / repository / 'scripts/check-application-project-tests.py'),
                str(destination / '.evidence/unit/results'))
        command(sys.executable, str(root / repository / 'scripts/check-policy-tests.py'),
                str(destination / '.evidence/postgres/results'))
(output / 'release-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
print(json.dumps(evidence))
