<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Models\AiProvider;
use Filament\Actions\ViewAction;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

/** The customer's AI provider settings. Keys are never shown: only whether one is stored. */
class AiProvidersRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'aiProviders';

    protected static string $permission = 'customers.view';

    protected static ?string $title = 'AI providers';

    public function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('provider_type')->label('Provider')->formatStateUsing(fn ($state) => ucfirst($state))->badge(),
                TextColumn::make('model_name')->label('Model')->fontFamily('mono'),
                IconColumn::make('key_stored')
                    ->label('API key')
                    ->state(fn (AiProvider $record) => filled($record->getRawOriginal('encrypted_api_key')))
                    ->boolean()
                    ->tooltip('Stored encrypted; never shown'),
                TextColumn::make('base_url')->label('Address')->placeholder('—'),
                IconColumn::make('is_active')->label('Active')->boolean(),
                TextColumn::make('updated_at')->label('Changed')->since(),
            ])
            ->recordActions([
                ViewAction::make()
                    ->modalHeading(fn (AiProvider $record) => ucfirst((string) $record->provider_type) . ' provider: ' . ($record->model_name ?: 'Default model'))
                    ->modalWidth('4xl'),
            ]);
    }

    public function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('AI Provider')
                    ->columns(3)
                    ->components([
                        TextEntry::make('provider_type')->label('Provider')->formatStateUsing(fn ($state) => ucfirst((string) $state))->badge(),
                        TextEntry::make('model_name')->label('Model')->fontFamily('mono')->placeholder('—'),
                        TextEntry::make('is_active')->label('Status')->badge()->formatStateUsing(fn ($state) => $state ? 'Active' : 'Inactive')->color(fn ($state) => $state ? 'success' : 'gray'),
                        TextEntry::make('base_url')->label('Endpoint URL')->placeholder('Default endpoint')->fontFamily('mono')->columnSpan(2),
                        TextEntry::make('key_stored')->label('API Key')->state(fn (AiProvider $record) => filled($record->getRawOriginal('encrypted_api_key')) ? ($record->masked_key ?? 'Stored encrypted (never shown)') : 'No key stored (local/free)'),
                        TextEntry::make('created_at')->label('Configured')->dateTime()->placeholder('—'),
                        TextEntry::make('updated_at')->label('Last updated')->dateTime()->placeholder('—'),
                    ]),
            ]);
    }
}
