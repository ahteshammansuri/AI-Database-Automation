<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Filament\Resources\OrbitTasks\OrbitTaskResource;
use App\Models\AgentTask;
use Filament\Tables\Table;

class OrbitTasksRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'agentTasks';

    protected static string $permission = 'orbit.view';

    protected static ?string $title = 'Orbit requests';

    public function table(Table $table): Table
    {
        return OrbitTaskResource::table($table)->recordUrl(fn (AgentTask $record) => OrbitTaskResource::getUrl('view', ['record' => $record]));
    }
}
