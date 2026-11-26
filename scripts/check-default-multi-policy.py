import json
import re
import sys


def direct_block(lines, key, indentation):
    candidates = [index for index, line in enumerate(lines)
                  if re.fullmatch(r" {" + str(indentation) + r"}" + re.escape(key) + r":\s*(?:#.*)?", line)]
    assert len(candidates) == 1, "Expected one direct configuration block: " + key
    start = candidates[0] + 1
    end = start
    while end < len(lines):
        line = lines[end]
        if line.strip() and not line.lstrip().startswith("#") and len(line) - len(line.lstrip(" ")) <= indentation:
            break
        end += 1
    return lines[start:end]


rendered = json.load(open(sys.argv[1]))
configuration = rendered["services"]["kestra"]["environment"]["KESTRA_CONFIGURATION"]
assert "policy-source: database" in configuration
assert "application-groups:" in configuration
assert "scopes: [openid,profile,email]" in configuration or "scopes: [openid, profile, email]" in configuration
assert "kestra:application-group-scopes" not in configuration, "Disabled first installation must use standard UI scopes"
assert "management-admin-subjects:" not in configuration
assert "deployment-multi-writer" not in configuration and "deployment-multi-reader" not in configuration
assert "role-mapping:" not in configuration and "instance-admin-roles:" not in configuration
lines = configuration.splitlines()
assert not any("\t" in line for line in lines), "Unsupported configuration indentation"
kestra = direct_block(lines, "kestra", 0)
amis = direct_block(kestra, "amis-apps", 2)
values = {}
for line in amis:
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    match = re.fullmatch(r"    ([a-z][a-z0-9-]*):\s*([^#\s]+)\s*(?:#.*)?", line)
    assert match, "Unsupported default AMIS configuration shape"
    key, value = match.groups()
    assert key not in values, "Duplicate default AMIS field: " + key
    values[key] = value
assert set(values) == {"enabled", "max-sync-concurrency", "request-body-timeout"}, "Missing or unexpected default AMIS fields"
assert values["enabled"] == "false", "Default AMIS must be disabled"
assert re.fullmatch(r"[1-9][0-9]*", values["max-sync-concurrency"]), "Default AMIS concurrency must be a positive integer"
assert values["max-sync-concurrency"] == "4", "Default AMIS concurrency must be 4"
assert values["request-body-timeout"] == "PT30S", "Default AMIS body timeout must be PT30S"
print("PASS default Compose uses application-project database policy without legacy administrator bypass or role mappings")
print("PASS default Compose disables AMIS with concurrency 4 and body timeout PT30S")
