"""Organization settings backed by the restricted database RPCs."""

from app.repositories import identity


def get_organization_settings(*, actor_id: str) -> dict:
    result = identity.rpc("get_organization_settings", p_actor=actor_id)
    if not isinstance(result, dict):
        raise identity.IdentityError("SETTINGS_UNAVAILABLE")
    return result


def update_organization_name(*, actor_id: str, organization_name: str) -> dict:
    result = identity.rpc(
        "update_organization_name",
        p_actor=actor_id,
        p_organization_name=organization_name,
    )
    if not isinstance(result, dict):
        raise identity.IdentityError("SETTINGS_UNAVAILABLE")
    return result
