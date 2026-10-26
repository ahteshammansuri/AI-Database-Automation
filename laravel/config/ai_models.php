<?php

/*
 * Models offered for each cloud provider in the portal (AI providers, model roles, automation builder).
 * Admins change these lists in the admin panel (Settings > AI & models); Ollama lists what is installed.
 */
return [
    'openai' => ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    'gemini' => ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'],
    'anthropic' => ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
    // Shown for Ollama when the model list cannot be read from the local server.
    'ollama_fallback' => ['qwen2.5:3b', 'llama3.2:1b', 'llama3.1:8b', 'mistral:7b'],
];
