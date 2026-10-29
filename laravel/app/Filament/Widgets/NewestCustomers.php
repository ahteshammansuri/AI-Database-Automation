<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\Customers\CustomerResource;
use App\Filament\Widgets\Concerns\HasSkeletonPlaceholder;
use App\Filament\Widgets\Concerns\RequiresDashboardPermission;
use App\Models\User;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;

class NewestCustomers extends TableWidget
{
    use HasSkeletonPlaceholder;
    use RequiresDashboardPermission;

    protected static ?int $sort = 4;

    public function table(Table $table): Table
    {
        return $table
            ->heading('Newest customers')
            ->query(fn () => User::query()->withCount('connections')->latest()->limit(6))
            ->paginated(false)
            ->columns([
                TextColumn::make('name')->description(fn (User $record) => $record->email),
                TextColumn::make('connections_count')->label('Connections')->alignCenter(),
                TextColumn::make('created_at')->label('Joined')->since(),
            ])
            ->recordUrl(fn (User $record) => CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record]) : null);
    }
}
