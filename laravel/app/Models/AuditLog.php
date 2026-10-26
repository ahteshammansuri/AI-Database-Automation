<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuditLog extends Model
{
    use HasFactory;

    protected $table = 'audit_logs';

    protected $fillable = [
        'user_id',
        'action',
        'resource_type',
        'resource_id',
        'metadata',
        'ip_address',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function log(
        ?int $userId,
        string $action,
        string $resourceType,
        ?string $resourceId = null,
        ?array $metadata = null,
        ?string $ipAddress = null
    ): self {
        return self::create([
            'user_id' => $userId,
            'action' => $action,
            'resource_type' => $resourceType,
            'resource_id' => $resourceId,
            'metadata' => $metadata,
            'ip_address' => $ipAddress ?? request()?->ip(),
        ]);
    }

    /**
     * Before -> after for the fields that really changed, ready for the metadata "changes" key. Long values are
     * shortened, secret fields keep only "changed", and personal data is masked as the portal shows it.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @param  array<int, string>  $secretFields  recorded as changed without values (passwords, API keys)
     * @return array<string, array{from: mixed, to: mixed}>
     */
    public static function changes(array $before, array $after, array $secretFields = []): array
    {
        $out = [];
        foreach (array_unique(array_merge(array_keys($before), array_keys($after))) as $field) {
            $from = $before[$field] ?? null;
            $to = $after[$field] ?? null;
            if (self::comparable($from) === self::comparable($to)) {
                continue;
            }
            if (in_array($field, $secretFields, true) || \App\Services\Data\ColumnClassifier::isSecret((string) $field)) {
                $out[$field] = ['from' => $from === null ? null : '(hidden)', 'to' => $to === null ? null : '(changed, hidden)'];
                continue;
            }
            $out[$field] = ['from' => self::shown($from, (string) $field), 'to' => self::shown($to, (string) $field)];
        }

        return $out;
    }

    private static function comparable(mixed $v): string
    {
        if ($v instanceof \DateTimeInterface) {
            return $v->format('Y-m-d H:i:s');
        }
        return is_array($v) || is_object($v) ? json_encode($v) : (string) ($v ?? '');
    }

    private static function shown(mixed $v, string $field): mixed
    {
        if ($v === null || is_bool($v) || is_int($v) || is_float($v)) {
            return $v;
        }
        if ($v instanceof \DateTimeInterface) {
            return $v->format(DATE_ATOM);
        }
        $text = is_array($v) || is_object($v) ? json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : (string) $v;
        $text = (string) \App\Services\Data\ColumnClassifier::mask($text, $field);

        return mb_strlen($text) > 400 ? mb_substr($text, 0, 400) . '…' : $text;
    }
}
