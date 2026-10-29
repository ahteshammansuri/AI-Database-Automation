<?php

namespace App\Services\Agent;

/**
 * Validates model-proposed tool arguments against the registry's JSON-schema subset
 * (type, required, enum, maxLength, minimum/maximum, no unexpected properties).
 *
 * Safe, lossless coercions are applied because small local models often emit numbers
 * as strings ("3308" -> 3308, "true" -> true). Anything else is rejected.
 */
class ToolArgumentValidator
{
    /**
     * @return array{valid: bool, args: array, errors: string[]}
     */
    public static function validate(array $schema, array $args): array
    {
        $errors = [];
        $props = (array) ($schema['properties'] ?? []);
        $required = $schema['required'] ?? [];
        $clean = [];

        foreach ($args as $key => $value) {
            if (!array_key_exists($key, $props)) {
                $errors[] = "unexpected argument '{$key}'";
                continue;
            }
            if ($value === null) {
                continue; // treated as omitted
            }
            [$ok, $coerced, $err] = self::checkValue((string) $key, $props[$key], $value);
            if (!$ok) {
                $errors[] = $err;
                continue;
            }
            $clean[$key] = $coerced;
        }

        foreach ($required as $req) {
            if (!array_key_exists($req, $clean) || $clean[$req] === '' || $clean[$req] === []) {
                $errors[] = "missing required argument '{$req}'";
            }
        }

        return ['valid' => empty($errors), 'args' => $clean, 'errors' => $errors];
    }

    protected static function checkValue(string $key, array $spec, mixed $value): array
    {
        $type = $spec['type'] ?? null;

        switch ($type) {
            case 'integer':
                if (is_string($value) && preg_match('/^-?\d+$/', trim($value))) {
                    $value = (int) trim($value);
                }
                if (is_float($value) && floor($value) == $value) {
                    $value = (int) $value;
                }
                if (!is_int($value)) {
                    return [false, null, "argument '{$key}' must be an integer"];
                }
                break;
            case 'number':
                if (is_string($value) && is_numeric(trim($value))) {
                    $value = trim($value) + 0;
                }
                if (!is_int($value) && !is_float($value)) {
                    return [false, null, "argument '{$key}' must be a number"];
                }
                break;
            case 'boolean':
                if (is_string($value) && in_array(strtolower($value), ['true', 'false'], true)) {
                    $value = strtolower($value) === 'true';
                }
                if (!is_bool($value)) {
                    return [false, null, "argument '{$key}' must be true or false"];
                }
                break;
            case 'string':
                if (is_int($value) || is_float($value)) {
                    $value = (string) $value;
                }
                if (!is_string($value)) {
                    return [false, null, "argument '{$key}' must be a string"];
                }
                $value = trim($value);
                $max = $spec['maxLength'] ?? 2000;
                if (mb_strlen($value) > $max) {
                    return [false, null, "argument '{$key}' is longer than {$max} characters"];
                }
                break;
            case 'array':
                if (is_string($value) && str_starts_with(trim($value), '[') && str_ends_with(trim($value), ']')) {
                    $decoded = json_decode(trim($value), true);
                    if (is_array($decoded)) {
                        $value = $decoded;
                    }
                }
                if (!is_array($value) || !array_is_list($value)) {
                    return [false, null, "argument '{$key}' must be a list"];
                }
                break;
            case 'object':
                if (is_string($value) && (str_starts_with(trim($value), '{') || str_starts_with(trim($value), '['))) {
                    $decoded = json_decode(trim($value), true);
                    if (is_array($decoded)) {
                        $value = $decoded;
                    }
                }
                if (!is_array($value)) {
                    return [false, null, "argument '{$key}' must be an object"];
                }
                break;
        }

        if (isset($spec['enum']) && !in_array($value, $spec['enum'], true)) {
            return [false, null, "argument '{$key}' must be one of: " . implode(', ', $spec['enum'])];
        }
        if (isset($spec['minimum']) && is_numeric($value) && $value < $spec['minimum']) {
            return [false, null, "argument '{$key}' must be at least {$spec['minimum']}"];
        }
        if (isset($spec['maximum']) && is_numeric($value) && $value > $spec['maximum']) {
            return [false, null, "argument '{$key}' must be at most {$spec['maximum']}"];
        }

        return [true, $value, null];
    }
}
