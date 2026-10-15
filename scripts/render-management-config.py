#!/usr/bin/env python3
import argparse, json, sys
from typing import Any
import yaml

class UniqueLoader(yaml.SafeLoader):
    pass

def construct_mapping(loader: UniqueLoader, node: yaml.MappingNode, deep: bool = False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ValueError("duplicate YAML key: " + str(key))
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping

UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping)

def reject_flat_aliases(value: Any, path: str = "") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(key, str) and (key == "kestra.rbac" or key.startswith("kestra.rbac.") or (path == "kestra" and key.startswith("rbac."))):
                raise ValueError("flat kestra.rbac alias is forbidden: " + key)
            child_path = str(key) if not path else path + "." + str(key)
            reject_flat_aliases(child, child_path)
    elif isinstance(value, list):
        for child in value:
            reject_flat_aliases(child, path)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-subject", action="append", required=True)
    args = parser.parse_args()
    subjects = []
    for subject in args.admin_subject:
        if not subject or subject != subject.strip() or "*" in subject:
            raise ValueError("admin subject must be non-empty and trimmed")
        if subject in subjects:
            raise ValueError("duplicate admin subject: " + subject)
        subjects.append(subject)
    compose = json.load(sys.stdin)
    raw = compose["services"]["kestra"]["environment"].get("KESTRA_CONFIGURATION")
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("kestra KESTRA_CONFIGURATION is missing or empty")
    configuration = yaml.load(raw, Loader=UniqueLoader)
    if not isinstance(configuration, dict):
        raise ValueError("KESTRA_CONFIGURATION must be a YAML mapping")
    reject_flat_aliases(configuration)
    kestra = configuration.setdefault("kestra", {})
    if not isinstance(kestra, dict):
        raise ValueError("kestra configuration must be a mapping")
    kestra["rbac"] = {"enabled": True, "typed": {"enabled": True}, "evaluation": {"enabled": True}, "management": {"enabled": True}, "policy-source": "database", "management-admin-subjects": subjects}
    rendered = yaml.safe_dump(configuration, allow_unicode=True, sort_keys=False).replace("$", "$$")
    override = {"services": {"kestra": {"environment": {"KESTRA_CONFIGURATION": rendered}}}}
    sys.stdout.write(yaml.safe_dump(override, allow_unicode=True, sort_keys=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyError:
        print("render-management-config: invalid compose input", file=sys.stderr)
        raise SystemExit(2)
    except yaml.YAMLError:
        print("render-management-config: invalid YAML", file=sys.stderr)
        raise SystemExit(2)
    except (TypeError, ValueError):
        print("render-management-config: invalid management configuration", file=sys.stderr)
        raise SystemExit(2)
