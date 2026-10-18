import json
import sys

rendered = json.load(open(sys.argv[1]))
configuration = rendered["services"]["kestra"]["environment"]["KESTRA_CONFIGURATION"]
assert "policy-source: database" in configuration
assert "application-projects:" in configuration
assert "scopes: [openid,profile,email]" in configuration or "scopes: [openid, profile, email]" in configuration
assert "kestra:project-scopes" not in configuration, "Disabled first installation must use standard UI scopes"
assert "management-admin-subjects:" not in configuration
assert "deployment-multi-writer" not in configuration and "deployment-multi-reader" not in configuration
assert "role-mapping:" not in configuration and "instance-admin-roles:" not in configuration
print("PASS default Compose uses application-project database policy without legacy administrator bypass or role mappings")
