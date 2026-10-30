<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Filament\Resources\Runs\RunResource;
use App\Models\AutomationExecution;
use Filament\Schemas\Schema;
use Filament\Tables\Table;

class RunsRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'executions';

    protected static string $permission = 'automations.view';

    protected static ?string $title = 'Automation runs';

    public function table(Table $table): Table
    {
        return RunResource::table($table)->recordUrl(fn (AutomationExecution $record) => RunResource::getUrl('view', ['record' => $record]));
    }

    public function infolist(Schema $schema): Schema
    {
        return RunResource::infolist($schema);
    }
}
