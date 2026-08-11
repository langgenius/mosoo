import json
import re
import time
import uuid
from collections.abc import Callable
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


# ponytail: The fixed origin keeps API tokens away from user-controlled hosts.
# Add self-hosted origins only with an explicit allowlist and Marketplace review.
API_BASE_URL = "https://cloud.mosoo.ai/api/v1"
MAX_PROMPT_LENGTH = 32_000
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
POLL_INTERVAL_SECONDS = 1.0
TERMINAL_STATUSES = {"cancelled", "completed", "expired", "failed"}
ULID_PATTERN = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")

ERROR_HINTS = {
    "agent_not_published": "Publish the mosoo Agent and enable API access.",
    "forbidden": "The mosoo token cannot access this Agent or Thread.",
    "idempotency_conflict": "The request is already processing. Retry with the returned thread_id.",
    "internal_error": "mosoo could not complete the request. Try again shortly.",
    "invalid_json": "mosoo rejected an invalid JSON request.",
    "invalid_request": "mosoo rejected the request. Check the Agent and Thread IDs.",
    "not_found": "The mosoo Agent or Thread was not found.",
    "rate_limited": "mosoo rate-limited the request. Try again shortly.",
    "readiness_blocked": "The mosoo Agent is not ready. Fix its configuration in mosoo.",
    "service_inactive": "The mosoo Agent API service is inactive. Republish the Agent.",
    "unauthenticated": "mosoo rejected the API token. Update the Dify plugin credentials.",
}


class MosooApiError(RuntimeError):
    def __init__(self, status: int, code: str, hint: str) -> None:
        super().__init__(f"mosoo API error ({status}, {code}): {hint}")
        self.status = status
        self.code = code


def validate_agent_id(value: str) -> str:
    return _validate_ulid(value, "Agent ID")


def validate_thread_id(value: str) -> str:
    return _validate_ulid(value, "Thread ID")


def validate_run_id(value: str) -> str:
    return _validate_ulid(value, "Run ID")


def _validate_ulid(value: str, label: str) -> str:
    normalized = value.strip().upper()
    if ULID_PATTERN.fullmatch(normalized) is None:
        raise ValueError(f"{label} must be a 26-character ULID.")
    return normalized


def _read_json(response: Any) -> dict[str, Any]:
    payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise MosooApiError(
            0, "response_too_large", "mosoo returned an oversized response."
        )
    try:
        parsed = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MosooApiError(
            0, "invalid_response", "mosoo returned invalid JSON."
        ) from error
    if not isinstance(parsed, dict):
        raise MosooApiError(
            0, "invalid_response", "mosoo returned an unexpected response."
        )
    return parsed


def _read_error_code(error: HTTPError) -> str:
    try:
        payload = _read_json(error)
    except MosooApiError:
        return "http_error"
    details = payload.get("error")
    if not isinstance(details, dict) or not isinstance(details.get("code"), str):
        return "http_error"
    return details["code"]


class MosooClient:
    def __init__(
        self,
        credential: str,
        opener: Callable[..., Any] = urlopen,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        credential = credential.strip()
        if not credential.startswith("mst_") or any(
            character.isspace() for character in credential
        ):
            raise ValueError(
                "mosoo API token must start with mst_ and contain no whitespace."
            )
        self._credential = credential
        self._opener = opener
        self._sleep = sleep
        self._monotonic = monotonic

    def list_threads(self, agent_id: str) -> None:
        self._request("GET", f"/agents/{validate_agent_id(agent_id)}/threads")

    def run(
        self,
        *,
        agent_id: str,
        prompt: str | None,
        thread_id: str | None,
        user_id: str,
        timeout_seconds: float,
    ) -> dict[str, str]:
        agent_id = validate_agent_id(agent_id)
        prompt = self._validate_prompt(prompt)
        user_id = self._validate_user_id(user_id)
        timeout_seconds = self._validate_timeout(timeout_seconds)

        if thread_id:
            thread_id = validate_thread_id(thread_id)
            snapshot = self._retrieve_thread(thread_id)
            thread = self._record(snapshot, "thread")
            if thread.get("userId") != user_id:
                raise ValueError("Thread ID does not belong to the current Dify user.")
            if prompt:
                accepted = self._request(
                    "POST",
                    f"/threads/{thread_id}/events",
                    body={
                        "events": [
                            {
                                "requestId": str(uuid.uuid4()),
                                "text": prompt,
                                "type": "user_message",
                            }
                        ]
                    },
                    idempotency_key=str(uuid.uuid4()),
                )
                events = accepted.get("events")
                if not isinstance(events, list) or not events:
                    raise MosooApiError(
                        0, "invalid_response", "mosoo did not return the accepted Run."
                    )
                if not isinstance(events[0], dict):
                    raise MosooApiError(
                        0, "invalid_response", "mosoo returned an invalid accepted Run."
                    )
                run = self._record(events[0], "run")
            else:
                run = snapshot.get("run")
                if run is None:
                    return self._result(
                        thread_id, "", "idle", "", "This Thread has no Run to wait for."
                    )
                if not isinstance(run, dict):
                    raise MosooApiError(
                        0, "invalid_response", "mosoo returned an invalid Run."
                    )
        else:
            if not prompt:
                raise ValueError("Task is required when starting a new Thread.")
            created = self._request(
                "POST",
                f"/agents/{agent_id}/threads",
                body={
                    "input": {
                        "content": [{"text": prompt, "type": "text"}],
                        "type": "user.message",
                    },
                    "userId": user_id,
                },
                idempotency_key=str(uuid.uuid4()),
            )
            thread = self._record(created, "thread")
            thread_id = validate_thread_id(str(thread.get("id", "")))
            run = self._record(created, "run")

        run_id = validate_run_id(str(run.get("id", "")))
        return self._wait(thread_id, run_id, run, timeout_seconds)

    def _wait(
        self,
        thread_id: str,
        run_id: str,
        run: dict[str, Any],
        timeout_seconds: float,
    ) -> dict[str, str]:
        deadline = self._monotonic() + timeout_seconds
        while True:
            status = str(run.get("status", ""))
            if status in TERMINAL_STATUSES:
                return self._terminal_result(thread_id, run_id, run)
            if status == "waiting_input":
                return self._result(
                    thread_id,
                    run_id,
                    status,
                    "",
                    "The mosoo Agent is waiting for permission or input. Resolve it in mosoo, then call this tool with thread_id only.",
                )
            remaining = deadline - self._monotonic()
            if remaining <= 0:
                return self._result(
                    thread_id,
                    run_id,
                    "timed_out",
                    "",
                    "The Run is still active. Call this tool again with thread_id only.",
                )
            self._sleep(min(POLL_INTERVAL_SECONDS, remaining))
            snapshot = self._retrieve_thread(thread_id)
            run = self._record(snapshot, "run")
            if run.get("id") != run_id:
                raise MosooApiError(
                    0, "run_changed", "The Thread now points to a different Run."
                )

    def _terminal_result(
        self, thread_id: str, run_id: str, run: dict[str, Any]
    ) -> dict[str, str]:
        status = str(run.get("status", ""))
        if status == "completed":
            final_output = run.get("finalOutput")
            if not isinstance(final_output, dict) or not isinstance(
                final_output.get("text"), str
            ):
                return self._result(
                    thread_id,
                    run_id,
                    status,
                    "",
                    "The completed mosoo Run did not include canonical final output.",
                )
            return self._result(thread_id, run_id, status, final_output["text"], "")

        error = run.get("error")
        code = error.get("code") if isinstance(error, dict) else None
        suffix = f" ({code})" if isinstance(code, str) and code else ""
        return self._result(
            thread_id, run_id, status, "", f"mosoo Run ended with {status}{suffix}."
        )

    def _retrieve_thread(self, thread_id: str) -> dict[str, Any]:
        return self._request("GET", f"/threads/{validate_thread_id(thread_id)}")

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._credential}",
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False).encode()
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        request = Request(
            f"{API_BASE_URL}{path}", data=data, headers=headers, method=method
        )
        try:
            with self._opener(request, timeout=30) as response:
                return _read_json(response)
        except HTTPError as error:
            code = _read_error_code(error)
            raise MosooApiError(
                error.code, code, ERROR_HINTS.get(code, "mosoo rejected the request.")
            ) from None
        except (TimeoutError, URLError):
            raise MosooApiError(
                0, "network_error", "Could not reach mosoo Cloud."
            ) from None

    @staticmethod
    def _record(container: dict[str, Any], key: str) -> dict[str, Any]:
        value = container.get(key)
        if not isinstance(value, dict):
            raise MosooApiError(
                0, "invalid_response", f"mosoo response is missing {key}."
            )
        return value

    @staticmethod
    def _validate_prompt(prompt: str | None) -> str | None:
        if prompt is None:
            return None
        if not isinstance(prompt, str):
            raise ValueError("Task must be text.")
        prompt = prompt.strip()
        if len(prompt) > MAX_PROMPT_LENGTH:
            raise ValueError(f"Task must be at most {MAX_PROMPT_LENGTH} characters.")
        return prompt or None

    @staticmethod
    def _validate_timeout(timeout_seconds: float) -> float:
        try:
            timeout_seconds = float(timeout_seconds)
        except (TypeError, ValueError) as error:
            raise ValueError("Wait timeout must be a number.") from error
        if not 10 <= timeout_seconds <= 240:
            raise ValueError("Wait timeout must be between 10 and 240 seconds.")
        return timeout_seconds

    @staticmethod
    def _validate_user_id(user_id: str) -> str:
        user_id = user_id.strip()
        if not user_id or len(user_id) > 255:
            raise ValueError("Dify user ID must contain 1 to 255 characters.")
        return user_id

    @staticmethod
    def _result(
        thread_id: str, run_id: str, status: str, text: str, error: str
    ) -> dict[str, str]:
        return {
            "error": error,
            "run_id": run_id,
            "status": status,
            "text": text,
            "thread_id": thread_id,
        }
