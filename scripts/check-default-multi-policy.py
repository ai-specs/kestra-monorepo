import json
import sys

rendered = json.load(open(sys.argv[1]))
configuration = rendered["services"]["kestra"]["environment"]["KESTRA_CONFIGURATION"]
assert "policy-source: database" in configuration
assert "management-admin-subjects:" in configuration
assert "deployment-multi-writer" not in configuration and "deployment-multi-reader" not in configuration
assert "role-mapping:" not in configuration and "instance-admin-roles:" not in configuration
print("PASS default Compose uses database policy source without legacy deployment role mappings")
