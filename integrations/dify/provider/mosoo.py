from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.mosoo_client import MosooClient, validate_agent_id


class MosooProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            agent_id = validate_agent_id(str(credentials.get("agent_id", "")))
            MosooClient(str(credentials.get("api_token", ""))).list_threads(agent_id)
        except (RuntimeError, ValueError) as error:
            raise ToolProviderCredentialValidationError(str(error)) from None
