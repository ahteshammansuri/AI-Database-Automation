<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Models\AiProvider;
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
            ]);
    }
}
