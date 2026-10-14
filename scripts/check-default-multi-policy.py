import json
import sys

rendered = json.load(open(sys.argv[1]))
configuration = rendered["services"]["kestra"]["environment"]["KESTRA_CONFIGURATION"]
for presented, local in (("multi-writer", "deployment-multi-writer"), ("multi-reader", "deployment-multi-reader")):
    assert f"{presented}: [{local}]" in configuration, f"Missing default mapping: {presented}"
    section = configuration.split(f"      {local}:\n", 1)[1].split("      deployment-", 1)[0]
    assert "resource: FLOW" in section and "resource: EXECUTION" in section
    assert "all-ids: true" in section
    if presented == "multi-reader":
        assert "namespace: \"rbac.multi\"" in section
        assert not any(action in section for action in ("CREATE", "UPDATE", "DELETE", "EXECUTE"))
    else:
        assert "namespace: \"rbac.allowed\"" in section
        assert "CREATE, UPDATE, DELETE, EXECUTE" in section
print("PASS default deployment cross-namespace role mappings and grants")
