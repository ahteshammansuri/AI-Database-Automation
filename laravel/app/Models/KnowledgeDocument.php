<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class KnowledgeDocument extends Model
{
    use HasFactory;

    protected $table = 'knowledge_documents';

    protected $fillable = [
        'user_id',
        'title',
        'file_path',
        'file_type',
        'file_size',
        'chunk_count',
        'vector_count',
        'status',
    ];

    protected $appends = ['filename'];

    public function getFilenameAttribute(): string
    {
        return $this->file_path ? basename($this->file_path) : ($this->title ?? 'document');
    }

    protected function casts(): array
    {
        return [
            'file_size' => 'integer',
            'chunk_count' => 'integer',
            'vector_count' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
