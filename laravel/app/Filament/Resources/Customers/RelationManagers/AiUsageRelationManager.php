<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Filament\Resources\AiUsage\AiUsageResource;
use Filament\Schemas\Schema;
use Filament\Tables\Table;

class AiUsageRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'aiUsageEvents';

    protected static string $permission = 'customers.view';

    protected static ?string $title = 'AI usage';

    public function table(Table $table): Table
    {
        return AiUsageResource::table($table);
    }

    public function infolist(Schema $schema): Schema
    {
        return AiUsageResource::infolist($schema);
    }
}
