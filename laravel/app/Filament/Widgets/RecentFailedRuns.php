<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\Runs\RunResource;
use App\Filament\Widgets\Concerns\HasSkeletonPlaceholder;
use App\Filament\Widgets\Concerns\RequiresDashboardPermission;
use App\Models\AutomationExecution;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;

class RecentFailedRuns extends TableWidget
{
    use HasSkeletonPlaceholder;
    use RequiresDashboardPermission;

    protected static ?int $sort = 5;

    public function table(Table $table): Table
    {
        return $table
            ->heading('Latest failed runs')
            ->query(fn () => AutomationExecution::query()->with(['automation', 'user'])->where('status', 'FAILED')->latest('id')->limit(6))
            ->paginated(false)
            ->emptyStateHeading('No failed runs')
            ->columns([
                TextColumn::make('automation.name')->label('Automation')->description(fn (AutomationExecution $record) => $record->user?->name)->placeholder('Manual publication')->limit(40),
                TextColumn::make('error_message')->label('Why')->limit(48)->tooltip(fn (AutomationExecution $record) => $record->error_message)->placeholder('—'),
                TextColumn::make('created_at')->label('When')->since(),
            ])
            ->recordUrl(fn (AutomationExecution $record) => RunResource::canViewAny() ? RunResource::getUrl('view', ['record' => $record]) : null);
    }
}
