import json


def database_policy(configuration, target, administrators):
    privileged = set(configuration.get("instance-admin-roles", []))
    document = {"schemaVersion": 1, "roles": [], "subjects": {}, "roleMapping": {}}
    for identifier, grants in configuration.get("roles", {}).items():
        if identifier in privileged:
            continue
        normalized = [{("allIds" if key == "all-ids" else key): value for key, value in grant.items()} for grant in grants]
        document["roles"].append({"id": identifier, "name": identifier, "description": "CI authorization matrix", "grants": normalized})
    for field, destination in (("subjects", "subjects"), ("role-mapping", "roleMapping")):
        for identity, identifiers in configuration.get(field, {}).items():
            ordinary = [identifier for identifier in identifiers if identifier not in privileged]
            if ordinary:
                document[destination][identity] = ordinary
    fixture_roles = {
        "rbac-reader": ["reader"], "rbac-writer": ["writer"],
        "rbac-multi": ["multi-reader", "multi-writer"], "rbac-exact": ["exact"]
    }
    for identity, identifiers in fixture_roles.items():
        ordinary = [identifier for identifier in identifiers if any(role["id"] == identifier for role in document["roles"])]
        if ordinary:
            document["subjects"][identity] = ordinary
    fixture_roles = {
        "rbac-reader": ["reader"], "rbac-writer": ["writer"],
        "rbac-multi": ["multi-reader", "multi-writer"], "rbac-exact": ["exact"]
    }
    for identity, identifiers in fixture_roles.items():
        ordinary = [identifier for identifier in identifiers if any(role["id"] == identifier for role in document["roles"])]
        if ordinary:
            document["subjects"][identity] = ordinary
    with open(target, "w") as output:
        json.dump(document, output)
    return {"enabled": configuration["enabled"], "typed": {"enabled": True}, "evaluation": {"enabled": configuration["enabled"]},
            "management": {"enabled": True}, "policy-source": "database", "management-admin-subjects": administrators}
