<?php

namespace App\Filament\Resources\OrbitTasks;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Customers\CustomerResource;
use App\Filament\Resources\OrbitTasks\Pages\ListOrbitTasks;
use App\Filament\Resources\OrbitTasks\Pages\ViewOrbitTask;
use App\Models\AgentTask;
use BackedEnum;
use Filament\Actions\ViewAction;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use UnitEnum;

/** What customers asked Orbit and how it went (read-only). Secrets never reach these records. */
class OrbitTaskResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = AgentTask::class;

    protected static string $permissionArea = 'orbit';

    protected static ?string $modelLabel = 'Orbit request';

    protected static ?string $slug = 'orbit-requests';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedSparkles;

    protected static string|UnitEnum|null $navigationGroup = 'Orbit';

    protected static ?string $navigationLabel = 'Requests';

    protected static ?int $navigationSort = 1;

    public const STATUSES = [
        'SUCCEEDED' => 'Done', 'ANSWERED' => 'Answered', 'PARTIAL_SUCCESS' => 'Partly done', 'FAILED' => 'Failed', 'CANCELLED' => 'Stopped',
        'SUPERSEDED' => 'Replaced', 'QUEUED' => 'Queued', 'RUNNING' => 'Working', 'WAITING_FOR_INPUT' => 'Waiting for the customer',
        'WAITING_FOR_APPROVAL' => 'Waiting for confirmation', 'PAUSED' => 'Paused',
    ];

    public static function statusColor(?string $status): string
    {
        return match ($status) {
            'SUCCEEDED', 'ANSWERED' => 'success',
            'FAILED' => 'danger',
            'PARTIAL_SUCCESS', 'WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'PAUSED' => 'warning',
            'RUNNING', 'QUEUED' => 'info',
            default => 'gray',
        };
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with('user')->withCount('toolCalls'))
            ->columns([
                TextColumn::make('goal')->label('Request')->limit(80)->tooltip(fn (AgentTask $record) => $record->goal)->searchable()->wrap(),
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->url(fn (AgentTask $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null),
                TextColumn::make('status')->badge()->formatStateUsing(fn ($state) => self::STATUSES[$state] ?? $state)->color(fn ($state) => self::statusColor($state)),
                TextColumn::make('tool_calls_count')->label('Tools used')->alignCenter(),
                TextColumn::make('iteration_count')->label('Steps')->alignCenter()->toggleable(),
                TextColumn::make('duration')
                    ->label('Took')
                    ->state(fn (AgentTask $record) => $record->completed_at ? $record->created_at->diffInSeconds($record->completed_at) : null)
                    ->formatStateUsing(fn ($state) => $state === null ? '—' : ($state >= 60 ? round($state / 60, 1) . ' min' : (int) $state . ' s')),
                TextColumn::make('created_at')->label('Asked')->since()->sortable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                SelectFilter::make('status')->multiple()->options(self::STATUSES),
            ])
            ->recordActions([ViewAction::make()]);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Request')
                    ->columns(4)
                    ->components([
                        TextEntry::make('goal')->label('Asked')->columnSpanFull(),
                        TextEntry::make('status')->badge()->formatStateUsing(fn ($state) => self::STATUSES[$state] ?? $state)->color(fn ($state) => self::statusColor($state)),
                        TextEntry::make('user.name')->label('Customer'),
                        TextEntry::make('autonomy_level')->label('Autonomy')->formatStateUsing(fn ($state) => str((string) $state)->replace('_', ' ')->lower()->ucfirst()),
                        TextEntry::make('iteration_count')->label('Steps taken'),
                        TextEntry::make('created_at')->label('Asked')->dateTime(),
                        TextEntry::make('completed_at')->label('Finished')->dateTime()->placeholder('—'),
                        TextEntry::make('error_message')->label('Problem')->placeholder('None')->columnSpanFull(),
                    ]),
                Section::make('Tools Orbit used')
                    ->components([
                        RepeatableEntry::make('toolCalls')
                            ->hiddenLabel()
                            ->schema([
                                TextEntry::make('tool')->hiddenLabel()->fontFamily('mono'),
                                TextEntry::make('status')->hiddenLabel()->badge()->color(fn ($state) => $state === 'succeeded' ? 'success' : ($state === 'failed' ? 'danger' : 'gray')),
                                TextEntry::make('error_category')->hiddenLabel()->placeholder('—'),
                                TextEntry::make('started_at')->hiddenLabel()->dateTime('H:i:s')->color('gray'),
                            ])
                            ->columns(4)
                            ->placeholder('No tools were used'),
                    ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListOrbitTasks::route('/'),
            'view' => ViewOrbitTask::route('/{record}'),
        ];
    }
}
