<?php

/*
 * Friendlier validation messages for the portal. Only these keys are overridden; every other message
 * comes from Laravel's defaults. Messages are shown directly under the field they belong to.
 */
return [
    'required' => ':Attribute is required.',
    'required_if' => ':Attribute is required.',
    'required_with' => ':Attribute is required.',
    'required_without' => ':Attribute is required.',
    'email' => 'Enter a valid email address, like name@example.com.',
    'unique' => 'This :attribute is already in use.',
    'confirmed' => 'The :attribute confirmation does not match.',
    'string' => ':Attribute must be text.',
    'integer' => ':Attribute must be a whole number.',
    'numeric' => ':Attribute must be a number.',
    'boolean' => ':Attribute must be yes or no.',
    'array' => ':Attribute is not in the expected format.',
    'in' => 'Choose a valid :attribute.',
    'url' => ':Attribute must be a full address starting with http:// or https://.',
    'timezone' => 'Use a valid timezone, like Asia/Kolkata or UTC.',
    'regex' => ':Attribute has an invalid format.',
    'file' => ':Attribute must be a file.',
    'extensions' => ':Attribute must be one of these types: :values.',
    'min' => [
        'array' => 'Choose at least :min :attribute.',
        'file' => ':Attribute must be at least :min KB.',
        'numeric' => ':Attribute must be at least :min.',
        'string' => ':Attribute must be at least :min characters.',
    ],
    'max' => [
        'array' => 'Choose no more than :max :attribute.',
        'file' => ':Attribute must be :max KB or smaller.',
        'numeric' => ':Attribute must be at most :max.',
        'string' => ':Attribute must be :max characters or fewer.',
    ],
    'between' => [
        'numeric' => ':Attribute must be between :min and :max.',
        'string' => ':Attribute must be between :min and :max characters.',
    ],

    'custom' => [
        'email' => [
            'unique' => 'An account with this email already exists. Sign in instead.',
        ],
        'password' => [
            'confirmed' => 'The passwords do not match.',
        ],
        'file' => [
            'max' => 'The file must be 10 MB or smaller.',
            'extensions' => 'Upload a Markdown (.md), text (.txt) or PDF (.pdf) file.',
        ],
        'base_url' => [
            'url' => 'Enter the full address, like http://localhost:11434.',
        ],
        'reviewer_email' => [
            'email' => 'Enter the reviewer\'s email address, like editor@example.com.',
        ],
    ],

    'attributes' => [
        'name' => 'name',
        'email' => 'email',
        'password' => 'password',
        'host' => 'host',
        'port' => 'port',
        'database_name' => 'database name',
        'username' => 'username',
        'connection_uri' => 'connection URI',
        'connection_timeout' => 'timeout',
        'ssl_mode' => 'TLS/SSL mode',
        'data_timezone' => 'database timezone',
        'access_mode' => 'access mode',
        'provider_type' => 'provider',
        'provider' => 'provider',
        'model_name' => 'model',
        'api_key' => 'API key',
        'base_url' => 'Ollama address',
        'file' => 'file',
        'title' => 'title',
        'query' => 'search text',
        'feedback' => 'feedback',
        'target_table' => 'table',
        'connection_id' => 'database connection',
        'reviewer_email' => 'reviewer email',
        'prompt_context' => 'topic',
        'user_notes' => 'notes',
        'temperature' => 'temperature',
        'max_tokens' => 'max tokens',
        'field_mappings' => 'column settings',
        'timezone' => 'timezone',
        'scheduled_at' => 'publication time',
        'content' => 'message',
    ],
];
