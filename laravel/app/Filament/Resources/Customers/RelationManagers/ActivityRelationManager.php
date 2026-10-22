<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Filament\Resources\CustomerActivity\CustomerActivityResource;
use Filament\Tables\Table;

class ActivityRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'auditLogs';

    protected static string $permission = 'audit.view';

    protected static ?string $title = 'Activity';

    public function table(Table $table): Table
    {
        return CustomerActivityResource::table($table);
    }
}
