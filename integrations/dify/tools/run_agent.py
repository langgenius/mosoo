from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.mosoo_client import MosooClient


class RunMosooAgentTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        result = MosooClient(str(self.runtime.credentials.get("api_token", ""))).run(
            agent_id=str(self.runtime.credentials.get("agent_id", "")),
            prompt=tool_parameters.get("prompt"),
            thread_id=tool_parameters.get("thread_id"),
            timeout_seconds=tool_parameters.get("timeout_seconds", 120),
            user_id=str(self.runtime.user_id or "dify-workflow"),
        )

        for name in ("text", "thread_id", "run_id", "status", "error"):
            yield self.create_variable_message(name, result[name])
        yield self.create_json_message(result)
