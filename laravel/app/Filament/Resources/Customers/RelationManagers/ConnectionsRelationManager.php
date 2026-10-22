<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Filament\Resources\Connections\ConnectionResource;
use App\Models\DbConnection;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class ConnectionsRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'connections';

    protected static string $permission = 'connections.view';

    protected static ?string $title = 'Connections';

    public function table(Table $table): Table
    {
        return ConnectionResource::table($table)->recordUrl(fn (DbConnection $record) => ConnectionResource::getUrl('view', ['record' => $record]));
    }
}
