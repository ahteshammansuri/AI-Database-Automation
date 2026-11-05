<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use App\Models\MediaAsset;
use App\Services\AiServiceClient;
use Illuminate\Support\Str;

/**
 * A new row for a customer's media table (uploads, files, attachments ...) describing an image the platform stored: a
 * generated cover or one the customer uploaded. Which column receives the web address, the file name, the extension,
 * the MIME type, the kind, the size or the pixel size comes from the roles the customer's model gave the media table's
 * columns (TableInsightService); nothing is matched by fixed column names. The row is then added by the executor or
 * the Data Manager in the same transaction as the row that points to it.
 */
class MediaRowBuilder
{
    public function __construct(
        private LiveSchemaService $schema,
        private AiServiceClient $ai,
    ) {}

    /** True when the model has read the media table's columns (at least where the file itself goes). */
    public function ready(DbConnection $connection, string $mediaTable): bool
    {
        $roles = $this->roles($connection, $mediaTable);
        return (bool) array_intersect($roles, ['file_url', 'file_path']);
    }

    /**
     * @return array{values: array<string, mixed>, label: string, notes: list<string>}
     *         values for the new media row (its name column is filled from `label` by the row builder)
     */
    public function forAsset(DbConnection $connection, string $mediaTable, MediaAsset $asset, string $name): array
    {
        $catalog = $this->schema->getCatalog($connection);
        $meta = $catalog['tables'][$mediaTable] ?? throw new DataException('TABLE_NOT_FOUND', "There is no table “{$mediaTable}”.");
        $roles = $this->roles($connection, $mediaTable);
        if (!array_intersect($roles, ['file_url', 'file_path'])) {
            throw new DataException('MEDIA_NOT_READ', "Your AI model has not read {$mediaTable} yet, so it is not known where the image's address goes. Open the table in the Schema Explorer and let the AI read it, then try again.");
        }

        $ext = match ($asset->mime_type) {
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            default => 'png',
        };
        $base = Str::slug(Str::limit($name, 80, '')) ?: 'image-' . $asset->id;
        $fileName = "{$base}.{$ext}";
        $hasUrlColumn = in_array('file_url', $roles, true);
        $values = [];
        $notes = [];
        foreach ($roles as $col => $role) {
            $c = $meta['columns'][$col] ?? null;
            if (!$c || !empty($c['auto']) || !empty($c['generated']) || $col === ($meta['label_column'] ?? null)) {
                continue;
            }
            $required = empty($c['nullable']) && $c['default'] === null;
            $value = match ($role) {
                'file_url' => $asset->url,
                // The file lives on this platform, not in the application's own storage: only its full address works.
                'file_path' => !$hasUrlColumn || $required ? $asset->url : null,
                'file_name' => $fileName,
                'file_extension' => $ext,
                'file_mime' => $asset->mime_type,
                'file_kind' => $this->imageKind($connection, $mediaTable, $col),
                'file_size' => (int) $asset->file_size,
                'image_width' => $asset->width,
                'image_height' => $asset->height,
                default => null,
            };
            if ($value === null || $value === '') {
                continue;
            }
            if (in_array($c['family'] ?? '', ['string', 'text'], true) && ($c['max_length'] ?? null) && mb_strlen((string) $value) > $c['max_length']) {
                $notes[] = "{$mediaTable}.{$col} is too short for the value and was left out.";
                continue;
            }
            $values[$col] = $value;
            if ($role === 'file_path' && !$hasUrlColumn) {
                $notes[] = "{$mediaTable}.{$col} receives the image's full web address, because the table has no separate address column.";
            }
        }

        return ['values' => $values, 'label' => $fileName, 'notes' => $notes];
    }

    /** column => AI role of the media table's columns. */
    private function roles(DbConnection $connection, string $mediaTable): array
    {
        $meta = $this->schema->getCatalog($connection)['tables'][$mediaTable] ?? [];
        $out = [];
        foreach ($meta['columns'] ?? [] as $col => $c) {
            if (!empty($c['ai_role'])) {
                $out[$col] = $c['ai_role'];
            }
        }
        return $out;
    }

    /** The stored value that means "image" in a kind column (image, video, document ...), found by meaning. */
    private function imageKind(DbConnection $connection, string $mediaTable, string $col): ?string
    {
        $meta = $this->schema->getCatalog($connection)['tables'][$mediaTable]['columns'][$col] ?? [];
        $labels = (array) ($meta['value_labels'] ?? []);
        $insight = app(TableInsightService::class)->forConnection($connection)[$mediaTable]['columns'][$col] ?? [];
        $values = array_map(fn ($v) => (string) $v['value'], (array) ($insight['values'] ?? []));
        $values = array_values(array_unique(array_merge($values, array_map('strval', (array) ($meta['enum'] ?? [])), array_keys($labels))));
        if (!$values) {
            return null;
        }
        $ranked = $this->ai->rankTables('a picture: an image or photo file', array_map(fn ($v) => [
            'name' => $v,
            'description' => trim($v . ' ' . ($labels[$v] ?? '')),
        ], $values), 1, 20);
        return $ranked[0]['name'] ?? null;
    }
}
