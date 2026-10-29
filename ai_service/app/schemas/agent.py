"""
Orbit agent decision protocol (orbit.v1).

One model call produces one AgentDecision. Laravel runs the observe-act loop:
it validates the decision, executes real registered tools, and sends the
observed results back in the next DecideRequest.
"""
import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROTOCOL_VERSION = "orbit.v1"

DecisionKind = Literal[
    "ANSWER",
    "ASK_CLARIFICATION",
    "CREATE_OR_REVISE_PLAN",
    "CALL_TOOL",
    "WAIT_FOR_USER",
    "REQUEST_CONFIRMATION",
    "INTERRUPT_OR_CANCEL",
    "UNSUPPORTED",
    "RECOVER",
    "PARTIAL_RESULT",
    "COMPLETE",
]
DECISION_KINDS: List[str] = list(DecisionKind.__args__)  # type: ignore[attr-defined]

ResponseStyle = Literal["conversational", "status", "question", "confirmation", "result", "error"]
RESPONSE_STYLES: List[str] = list(ResponseStyle.__args__)  # type: ignore[attr-defined]

EmotionHint = Literal["neutral", "happy", "curious", "focused", "attentive", "concerned", "apologetic", "celebrating"]
EMOTION_HINTS: List[str] = list(EmotionHint.__args__)  # type: ignore[attr-defined]

SecureInputType = Literal["database_password", "api_key"]
SECURE_INPUT_TYPES: List[str] = list(SecureInputType.__args__)  # type: ignore[attr-defined]

CancelAction = Literal["STOP", "PAUSE", "RESUME"]

# Keys the model must never place in tool args or slots. Secrets travel only
# through Laravel's SecretVault.
SECRET_KEY_PATTERN = re.compile(r"(pass(word)?|secret|token|api[_-]?key|credential)", re.IGNORECASE)

# What each decision kind does in the observe-act loop. Part of the protocol (like a function signature), shown to the
# model next to the decision schema; how to behave in a situation comes from retrieved knowledge, not from here.
KIND_MEANINGS: Dict[str, str] = {
    "CALL_TOOL": "run one tool from TOOLS now (tool_call); its real result comes back in OBSERVATIONS on the next call",
    "ANSWER": "reply to the user from facts you have (context, observations, retrieved passages); the request is answered",
    "ASK_CLARIFICATION": "ask one short question because the request is ambiguous or a choice only the user can make is missing",
    "WAIT_FOR_USER": "wait for the user to type into a form (missing_fields) or the secure field (secure_input_type)",
    "REQUEST_CONFIRMATION": "ask the user to confirm a prepared step before it runs",
    "CREATE_OR_REVISE_PLAN": "state the steps (plan) of a long request before acting",
    "INTERRUPT_OR_CANCEL": "the user wants to stop, pause or resume (cancel_action)",
    "UNSUPPORTED": "the request is outside what the tools can do; say what is possible instead",
    "RECOVER": "a step failed; explain plainly and offer the way forward",
    "PARTIAL_RESULT": "report what was done and what is still left",
    "COMPLETE": "the request is done; report the verified result",
}

# Kinds that end the turn and must carry something to say.
SPOKEN_KINDS = {
    "ANSWER", "ASK_CLARIFICATION", "WAIT_FOR_USER", "REQUEST_CONFIRMATION",
    "UNSUPPORTED", "RECOVER", "PARTIAL_RESULT", "COMPLETE", "INTERRUPT_OR_CANCEL",
}


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=80)
    args: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("args")
    @classmethod
    def no_secret_args(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        bad = [k for k in v if SECRET_KEY_PATTERN.search(k)]
        if bad:
            raise ValueError(f"secret-bearing args are not allowed in model output: {bad}")
        return v


class PlanItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: str = Field(..., max_length=80)
    purpose: str = Field("", max_length=200)


class AgentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: DecisionKind
    speech_text: str = Field("", max_length=1400, description="what Orbit says now, in the user's language and style")
    tool_call: Optional[ToolCall] = Field(None, description="with CALL_TOOL: {name, args}, args exactly as the tool's parameters")
    plan: List[PlanItem] = Field(default_factory=list, max_length=12, description="with CREATE_OR_REVISE_PLAN: the steps")
    missing_fields: List[str] = Field(default_factory=list, max_length=12, description="form fields the user still has to fill")
    secure_input_type: Optional[SecureInputType] = Field(None, description="the secret the user must type in the secure field")
    cancel_action: Optional[CancelAction] = None
    slot_updates: Dict[str, Any] = Field(default_factory=dict, description="non-secret facts to keep for this request, e.g. the connection_id the user chose")
    response_style: ResponseStyle = "conversational"
    emotion_hint: EmotionHint = "neutral"
    reasoning_summary: str = Field("", max_length=400)
    # One short line shown to the user as Orbit's thinking (what it understood and what it will do next).
    thought: str = Field("", max_length=240, description="one short line (max 25 words): what you understood and will do; shown to the user")
    # On-screen steps the server runs right after tool_call without asking the model again (non-consequential only).
    then: List[ToolCall] = Field(default_factory=list, max_length=6, description="up to 6 on-screen steps run right after tool_call without another decision")
    # tool_call (and its `then` steps) completes the request: the server reports the verified result and ends the turn.
    finish_after: bool = Field(False, description="true when tool_call (and then) completes the request")

    @field_validator("slot_updates", mode="before")
    @classmethod
    def coerce_empty_slots(cls, v: Any) -> Any:
        return {} if (v == [] or v is None) else v

    @field_validator("slot_updates")
    @classmethod
    def no_secret_slots(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(v, dict):
            return {}
        bad = [k for k in v if SECRET_KEY_PATTERN.search(k)]
        if bad:
            raise ValueError(f"secret-bearing slots are not allowed in model output: {bad}")
        return v

    @model_validator(mode="after")
    def check_kind_requirements(self) -> "AgentDecision":
        if self.kind == "CALL_TOOL" and self.tool_call is None:
            raise ValueError("CALL_TOOL requires tool_call")
        if self.kind != "CALL_TOOL" and self.tool_call is not None:
            raise ValueError("tool_call is only allowed when kind is CALL_TOOL")
        if self.kind != "CALL_TOOL" and (self.then or self.finish_after):
            raise ValueError("then and finish_after are only allowed when kind is CALL_TOOL")
        if self.kind == "WAIT_FOR_USER" and self.secure_input_type is None and not self.missing_fields:
            raise ValueError("WAIT_FOR_USER requires secure_input_type or missing_fields")
        if self.kind == "INTERRUPT_OR_CANCEL" and self.cancel_action is None:
            raise ValueError("INTERRUPT_OR_CANCEL requires cancel_action")
        if self.kind == "CREATE_OR_REVISE_PLAN" and not self.plan:
            raise ValueError("CREATE_OR_REVISE_PLAN requires a non-empty plan")
        if self.kind in SPOKEN_KINDS and not self.speech_text.strip():
            raise ValueError(f"{self.kind} requires speech_text")
        return self


class ToolSchema(BaseModel):
    """Model-visible description of a registered capability (generated by Laravel's registry)."""
    model_config = ConfigDict(extra="ignore")

    name: str
    description: str = ""
    parameters: Dict[str, Any] = Field(default_factory=dict)
    side_effect_class: str = "read"
    requires_confirmation: bool = False
    available: bool = True
    unavailable_reason: Optional[str] = None


def _empty_list_to_dict(v: Any) -> Any:
    """PHP serialises an empty associative array as []; treat it as an empty object."""
    return {} if v == [] else v


class Observation(BaseModel):
    """A real tool result observed by Laravel during this turn."""
    model_config = ConfigDict(extra="ignore")

    iteration: int = 0
    tool: str
    args: Dict[str, Any] = Field(default_factory=dict)
    result: Dict[str, Any] = Field(default_factory=dict)

    _coerce = field_validator("args", "result", mode="before")(classmethod(lambda cls, v: _empty_list_to_dict(v)))


class RetrievedChunk(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source_id: str
    scope: str  # "product" (Orbit's knowledge), "user_kb" (the user's documents) or "schema" (their tables)
    text: str
    score: float = 0.0
    heading: Optional[str] = None


class SchemaDocument(BaseModel):
    """One table of one of the user's connected databases, described by Laravel from its latest schema scan."""
    model_config = ConfigDict(extra="ignore")

    connection_id: int
    connection: str = Field("", max_length=160)
    database: Optional[str] = Field(None, max_length=160)
    table: str = Field(..., min_length=1, max_length=160)
    # Columns, types, keys, allowed values, size and access, in plain words (what retrieval matches against).
    text: str = Field("", max_length=2400)


class DecideRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    protocol_version: str = PROTOCOL_VERSION
    user_id: int = Field(..., ge=1)
    utterance: str = Field(..., min_length=1, max_length=4000)
    runtime_context: Dict[str, Any] = Field(default_factory=dict)
    tool_schemas: List[ToolSchema] = Field(default_factory=list)
    # Catalog of on-screen surfaces (page, fields, actions) Orbit can operate with the UI tools.
    portal_map: List[Dict[str, Any]] = Field(default_factory=list)
    # The product's name as set in the admin panel (Settings > General > Brand).
    product_name: str = Field("Rowpilot", min_length=1, max_length=60)
    system_prompt: Optional[str] = None
    system_instructions: Optional[str] = None
    # The customer's 'Orbit & planning' temperature; low values make decisions steadier.
    temperature: Optional[float] = Field(None, ge=0.0, le=1.5)
    observations: List[Observation] = Field(default_factory=list)
    conversation_summary: List[Dict[str, Any]] = Field(default_factory=list)
    slots: Dict[str, Any] = Field(default_factory=dict)
    # Chunks retrieved on an earlier iteration of the same turn; reused instead of re-querying.
    retrieved_context: Optional[List[RetrievedChunk]] = None
    use_rag: bool = True
    # Every table of every connected database; the ones the request is about are retrieved into the context.
    schema_documents: List[SchemaDocument] = Field(default_factory=list, max_length=4000)
    iteration: int = 0
    provider: str = "ollama"
    model: Optional[str] = None
    api_key: Optional[str] = None
    max_repairs: int = Field(2, ge=0, le=3)
    # Total time budget for this decision. Laravel sets it below its own HTTP timeout so the
    # AI service always answers (with MODEL_BUSY_OR_SLOW if needed) before Laravel gives up.
    deadline_seconds: float = Field(280.0, ge=10.0, le=1800.0)

    @field_validator("slots", "runtime_context", mode="before")
    @classmethod
    def coerce_empty_dict(cls, v: Any) -> Any:
        return {} if v == [] or v is None else v


class RagInfo(BaseModel):
    attempted: bool = False
    used: bool = False  # True only if chunks were actually placed in the model request
    count: int = 0
    source_ids: List[str] = Field(default_factory=list)
    index_version: Optional[str] = None
    embedding_backend: Optional[str] = None
    error: Optional[str] = None
    chunks: List[RetrievedChunk] = Field(default_factory=list)
    offered_tools: List[str] = Field(default_factory=list)  # tools described in full to the model this call


class DecideResponse(BaseModel):
    protocol_version: str = PROTOCOL_VERSION
    success: bool
    decision: Optional[AgentDecision] = None
    error_category: Optional[str] = None  # MODEL_UNAVAILABLE, MODEL_OUTPUT_INVALID, PROVIDER_ERROR, PROVIDER_UNSUPPORTED
    error_message: Optional[str] = None
    rag: RagInfo = Field(default_factory=RagInfo)
    provider_used: Optional[str] = None
    model_used: Optional[str] = None
    # Why another model answered than the one chosen, e.g. "gemini-3.5-flash: its quota is used up".
    model_notes: List[str] = Field(default_factory=list)
    duration_ms: int = 0
    repairs: int = 0
