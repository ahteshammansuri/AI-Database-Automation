<?php

namespace App\Filament\Resources\Customers\RelationManagers;

use App\Filament\Concerns\ReadOnlyRelationManager;
use App\Filament\Resources\Automations\AutomationResource;
use App\Models\Automation;
use App\Services\Automation\ScheduleCalculator;
use Filament\Schemas\Schema;
use Filament\Tables\Table;

class AutomationsRelationManager extends ReadOnlyRelationManager
{
    protected static string $relationship = 'automations';

    protected static string $permission = 'automations.view';

    protected static ?string $title = 'Automations';

    public function table(Table $table): Table
    {
        return AutomationResource::table($table)
            ->modifyQueryUsing(fn ($query) => $query->where('schedule_type', '!=', ScheduleCalculator::TYPE_NONE)->withCount(AutomationResource::runCounts()))
            ->recordUrl(fn (Automation $record) => AutomationResource::getUrl('view', ['record' => $record]));
    }

    public function infolist(Schema $schema): Schema
    {
        return AutomationResource::infolist($schema);
    }
}
