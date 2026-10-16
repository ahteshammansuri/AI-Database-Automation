<?php

namespace App\Services\Automation;

/**
 * Placeholder used only in dry-run write plans for a foreign key whose parent record does not
 * exist yet and will be created first. It is never bound to a real INSERT.
 */
final class PendingParentId
{
    public function __construct(public readonly string $table, public readonly string $label)
    {
    }

    public function __toString(): string
    {
        return "new {$this->table} id ('{$this->label}')";
    }
}
