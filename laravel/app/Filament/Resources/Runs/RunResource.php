<?php

namespace App\Filament\Resources\Runs;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Automations\AutomationResource;
use App\Filament\Resources\Customers\CustomerResource;
use App\Filament\Resources\Runs\Pages\ListRuns;
use App\Filament\Resources\Runs\Pages\ViewRun;
use App\Models\AutomationExecution;
use BackedEnum;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\DatePicker;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use UnitEnum;

/** Every automation run (read-only): status, timing, failures and the run's timeline. */
class RunResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = AutomationExecution::class;

    protected static string $permissionArea = 'automations';

    protected static ?string $modelLabel = 'run';

    protected static ?string $slug = 'runs';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedQueueList;

    protected static string|UnitEnum|null $navigationGroup = 'Customers';

    protected static ?string $navigationLabel = 'Runs';

    protected static ?int $navigationSort = 4;

    public static function statusColor(?string $status): string
    {
        return match ($status) {
            'PUBLISHED' => 'success',
            'FAILED', 'REJECTED' => 'danger',
            'MISSED', 'SKIPPED', 'CANCELLED' => 'gray',
            'PENDING_APPROVAL', 'APPROVED' => 'warning',
            default => 'info',
        };
    }

    public static function label(?string $value): string
    {
        return (string) str((string) $value)->replace('_', ' ')->lower()->ucfirst();
    }

    public static function getNavigationBadge(): ?string
    {
        $failed = AutomationExecution::where('status', 'FAILED')->where('created_at', '>=', now()->subDay())->count();
        return $failed ?: null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'danger';
    }

    public static function getNavigationBadgeTooltip(): ?string
    {
        return 'Failed runs in the last 24 hours';
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with(['automation', 'user']))
            ->columns([
                TextColumn::make('id')->label('#')->sortable(),
                TextColumn::make('automation.name')
                    ->label('Automation')
                    ->description(fn (AutomationExecution $record) => $record->automation?->target_table ? '→ ' . $record->automation->target_table : null)
                    ->url(fn (AutomationExecution $record) => $record->automation && AutomationResource::canViewAny() && $record->automation->schedule_type !== 'NONE'
                        ? AutomationResource::getUrl('view', ['record' => $record->automation]) : null)
                    ->placeholder('Manual publication')
                    ->wrap(),
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->url(fn (AutomationExecution $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null)
                    ->searchable(),
                TextColumn::make('status')->badge()->formatStateUsing(fn ($state) => self::label($state))->color(fn ($state) => self::statusColor($state)),
                TextColumn::make('failure_category')->label('Failure')->formatStateUsing(fn ($state) => self::label($state))->placeholder('—')->toggleable(),
                TextColumn::make('publication_time')->label('Publishes')->dateTime('M j, H:i')->sortable()->placeholder('—'),
                TextColumn::make('published_at')->label('Published')->since()->placeholder('—')->toggleable(),
                TextColumn::make('created_at')->label('Started')->since()->sortable(),
            ])
            ->defaultSort('id', 'desc')
            ->filters([
                SelectFilter::make('status')->multiple()->options(collect(['PENDING_GENERATION', 'GENERATING', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'MISSED', 'SKIPPED', 'CANCELLED', 'REJECTED'])
                    ->mapWithKeys(fn ($s) => [$s => self::label($s)])->all()),
                SelectFilter::make('failure_category')->label('Failure')->options(['GENERATION_ERROR' => 'Generation error', 'TRANSACTION_ROLLBACK' => 'Write rolled back', 'MISSED_WINDOW' => 'Missed window', 'MAX_REJECTIONS_EXCEEDED' => 'Too many rejections']),
                Filter::make('started')
                    ->schema([DatePicker::make('from')->label('Started from'), DatePicker::make('until')->label('Started until')])
                    ->query(fn (Builder $query, array $data) => $query
                        ->when($data['from'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
                        ->when($data['until'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))),
            ])
            ->recordActions([ViewAction::make()]);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Run')
                    ->columns(4)
                    ->components([
                        TextEntry::make('status')->badge()->formatStateUsing(fn ($state) => self::label($state))->color(fn ($state) => self::statusColor($state)),
                        TextEntry::make('automation.name')->label('Automation')->placeholder('Manual publication'),
                        TextEntry::make('user.name')->label('Customer'),
                        TextEntry::make('trigger_type')->label('Started by')->formatStateUsing(fn ($state) => $state === 'SCHEDULE' ? 'Schedule' : self::label($state))->placeholder('—'),
                        TextEntry::make('scheduled_generation_at')->label('Writes at')->dateTime()->placeholder('—'),
                        TextEntry::make('publication_time')->label('Publishes at')->dateTime()->placeholder('—'),
                        TextEntry::make('published_at')->label('Published')->dateTime()->placeholder('—'),
                        TextEntry::make('target_record_id')->label('Row written')->placeholder('—'),
                        TextEntry::make('queue_wait_ms')->label('Queue wait')->suffix(' ms')->placeholder('—'),
                        TextEntry::make('execution_duration_ms')->label('Took')->suffix(' ms')->placeholder('—'),
                        TextEntry::make('retry_count')->label('Retries'),
                        TextEntry::make('failure_category')->label('Failure')->formatStateUsing(fn ($state) => self::label($state))->placeholder('None'),
                        TextEntry::make('error_message')->label('Error')->placeholder('None')->columnSpanFull(),
                    ]),
                Section::make('Timeline')
                    ->components([
                        RepeatableEntry::make('timeline_events')
                            ->hiddenLabel()
                            ->state(fn (AutomationExecution $record) => array_values(array_map(
                                fn ($e) => ['stage' => $e['stage'] ?? '', 'message' => $e['message'] ?? '', 'timestamp' => $e['timestamp'] ?? null],
                                (array) $record->timeline_events
                            )))
                            ->schema([
                                TextEntry::make('stage')->hiddenLabel()->badge()->formatStateUsing(fn ($state) => self::label($state))->color('gray'),
                                TextEntry::make('message')->hiddenLabel()->columnSpan(3),
                                TextEntry::make('timestamp')->hiddenLabel()->dateTime('M j, H:i:s')->color('gray'),
                            ])
                            ->columns(5)
                            ->placeholder('No timeline recorded'),
                    ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListRuns::route('/'),
            'view' => ViewRun::route('/{record}'),
        ];
    }
}
