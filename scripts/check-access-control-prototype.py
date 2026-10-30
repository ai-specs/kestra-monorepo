import hashlib
import json
from pathlib import Path
import re
import sys


def check(requirements_path, prototype_path):
    requirements = requirements_path.read_text(encoding="utf-8")
    source = prototype_path.read_bytes()
    prototype = source.decode("utf-8")
    hashes = re.findall(
        r"assert hashlib\.sha256\(source\)\.hexdigest\(\) == '([0-9a-f]{64})'",
        requirements,
    )
    assert len(hashes) == 1, "One complete section 11 hash assertion is required"
    frozen = re.search(
        r"当前冻结文件 SHA-256：\s*`([0-9a-f]{64})`", requirements
    )
    assert frozen and frozen.group(1) == hashes[0], "Prose and validation hashes differ"
    actual_hash = hashlib.sha256(source).hexdigest()
    assert actual_hash == hashes[0], "Prototype differs from the reviewed frozen input"
    data_match = re.search(r"const DATA\s*=\s*(\{.*?\});", prototype, re.S)
    rulings_match = re.search(
        r'<script[^>]*type="application/rulings\+json"[^>]*>(.*?)</script>',
        prototype,
        re.S,
    )
    assert data_match and rulings_match, "Prototype data and rulings are required"
    data = json.loads(data_match.group(1))
    rulings = json.loads(rulings_match.group(1))["rulings"]
    assert [ruling["id"] for ruling in rulings] == [
        f"R{number}" for number in range(1, 13)
    ], "Historical rulings must remain complete and ordered"
    assert prototype.count("data-field-note=") == 20, "Expected 20 field notes"
    expected_counts = dict(
        zip(
            ["scopes", "applications", "declarations", "userDirectory", "impl"],
            [19, 1, 19, 22, 18],
        )
    )
    counts = {name: len(data[name]) for name in expected_counts}
    assert counts == expected_counts, "Frozen data counts differ"
    assert len(set(data["userDirectory"])) == 22, "Duplicate standard user"
    assert 'id="app-register-form"' not in prototype, "Retired sidebar form remains"
    assert 'data-test="application-register"' in prototype, "Registration form missing"
    assert "function newApplication()" in prototype, "Sidebar registration action missing"
    return {
        "status": "passed",
        "scope": "frozen-prototype-only",
        "sha256": actual_hash,
        "rulings": len(rulings),
        "fieldNotes": 20,
        "counts": counts,
        "businessAcceptance": False,
    }


if __name__ == "__main__":
    repository = Path(__file__).resolve().parent.parent
    paths = sys.argv[1:]
    assert len(paths) in (0, 2), "Use no arguments or requirements and prototype paths"
    requirements_path, prototype_path = (
        [Path(path) for path in paths]
        if paths
        else [
            repository / "docs/access-control-ui-requirements.md",
            repository / "docs/prototype-application-groups.html",
        ]
    )
    print(json.dumps(check(requirements_path, prototype_path), ensure_ascii=False))
