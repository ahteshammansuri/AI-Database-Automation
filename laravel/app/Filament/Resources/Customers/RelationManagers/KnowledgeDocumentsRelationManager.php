<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Models\KnowledgeDocument;
use Filament\Actions\ViewAction;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
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
            ])
            ->recordActions([
                ViewAction::make()
                    ->modalHeading(fn (KnowledgeDocument $record) => 'Document: ' . $record->title)
                    ->modalWidth('4xl'),
            ]);
    }

    public function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Knowledge Document')
                    ->columns(3)
                    ->components([
                        TextEntry::make('title')->label('Title')->columnSpan(2),
                        TextEntry::make('status')->badge()->color(fn ($state) => in_array(strtolower((string) $state), ['indexed', 'ready', 'completed'], true) ? 'success' : 'gray'),
                        TextEntry::make('file_type')->label('Format')->badge()->formatStateUsing(fn ($state) => strtoupper((string) $state)),
                        TextEntry::make('file_size')->label('Size')->formatStateUsing(fn ($state) => $state ? number_format($state / 1024, 1) . ' KB' : '—'),
                        TextEntry::make('chunk_count')->label('Extracted passages (chunks)')->placeholder('0'),
                        TextEntry::make('vector_count')->label('Vector embeddings indexed')->placeholder('0'),
                        TextEntry::make('created_at')->label('Uploaded')->dateTime()->placeholder('—'),
                        TextEntry::make('updated_at')->label('Last indexed')->dateTime()->placeholder('—'),
                    ]),
            ]);
    }
}
