<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One product guide Orbit retrieves from (Markdown; each ## section is one retrievable piece). */
class OrbitKnowledgeGuide extends Model
{
    public const SLUG_PATTERN = '/^[a-z0-9][a-z0-9_-]{0,80}$/';

    protected $fillable = ['slug', 'title', 'body', 'is_published', 'sort', 'updated_by'];

    protected function casts(): array
    {
        return ['is_published' => 'boolean', 'sort' => 'integer', 'published_at' => 'datetime'];
    }

    public function editor(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'updated_by');
    }

    /**
     * What the AI service receives for this guide; its hash tells whether the live copy is current. "{brand}" becomes
     * the brand name from the admin settings, so renaming the product changes what Orbit says after the next publish.
     */
    public function payload(): array
    {
        $brand = (string) config('platform.brand_name', 'Rowpilot');

        return [
            'name' => $this->slug,
            'title' => str_replace('{brand}', $brand, (string) $this->title),
            'content' => str_replace('{brand}', $brand, (string) $this->body),
        ];
    }

    public function contentHash(): string
    {
        return hash('sha256', json_encode($this->payload()));
    }

    /** live | pending (new or edited, not published yet) | removing (excluded, still live) | hidden */
    public function liveState(): string
    {
        if ($this->is_published) {
            return $this->published_hash === $this->contentHash() ? 'live' : 'pending';
        }
        return $this->published_hash ? 'removing' : 'hidden';
    }
}
