<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class KnowledgeDocumentsRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'knowledgeDocuments';

    protected static string $permission = 'customers.view';

    protected static ?string $title = 'Knowledge documents';

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('title')->searchable()->wrap(),
                TextColumn::make('file_type')->label('Type')->badge()->formatStateUsing(fn ($state) => strtoupper((string) $state)),
                TextColumn::make('file_size')->label('Size')->formatStateUsing(fn ($state) => $state ? number_format($state / 1024, 1) . ' KB' : '—'),
                TextColumn::make('chunk_count')->label('Passages'),
                TextColumn::make('status')->badge()->color(fn ($state) => in_array(strtolower((string) $state), ['indexed', 'ready', 'completed'], true) ? 'success' : 'gray'),
                TextColumn::make('created_at')->label('Uploaded')->since()->sortable(),
            ]);
    }
}
