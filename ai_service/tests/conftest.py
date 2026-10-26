import os

# The placeholder "mock" provider is refused in the product; the automated tests use it to script model answers.
os.environ.setdefault("AI_ALLOW_MOCK_PROVIDER", "1")
