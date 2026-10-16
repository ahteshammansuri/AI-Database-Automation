<?php

namespace App\Services\Data;

use RuntimeException;

/**
 * A data-agent failure with a stable machine code and a plain-English message that is safe to
 * show the user (no credentials, no row values). `details` carries structured, non-secret
 * context such as candidate tables or the allowed modes.
 */
class DataException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
        public readonly bool $retryable = false,
    ) {
        parent::__construct($message);
    }

    public static function policy(string $code, string $message, array $details = []): self
    {
        return new self($code, $message, $details);
    }

    public function toArray(): array
    {
        return array_filter([
            'code' => $this->errorCode,
            'message' => $this->getMessage(),
            'details' => $this->details ?: null,
            'retryable' => $this->retryable ?: null,
        ], fn ($v) => $v !== null);
    }
}
