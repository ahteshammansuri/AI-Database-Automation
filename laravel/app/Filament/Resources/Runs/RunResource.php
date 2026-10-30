<?php

namespace App\Filament\Resources\Runs;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Automations\AutomationResource;
use App\Filament\Resources\Customers\CustomerResource;
use App\Filament\Resources\Runs\Pages\ListRuns;
use App\Filament\Resources\Runs\Pages\ViewRun;
use App\Models\AutomationExecution;
use BackedEnum;
use Filament\Actions\Action;
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

    protected static ?string $modelLabel = 'automation run';

    protected static ?string $slug = 'runs';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedQueueList;

    protected static string|UnitEnum|null $navigationGroup = 'Customers';

    protected static ?string $navigationLabel = 'Automation runs';

    /** Run statuses in plain words (same wording as the customer portal). */
    public const STATUS_LABELS = [
        'PENDING_GENERATION' => 'Waiting to start', 'QUEUED' => 'Waiting to start', 'RUNNING' => 'Running', 'GENERATING' => 'Writing',
        'REGENERATING' => 'Rewriting', 'PENDING_APPROVAL' => 'Waiting for approval', 'APPROVED' => 'Approved',
        'READY_TO_PUBLISH' => 'Ready to publish', 'PUBLISHING' => 'Publishing', 'PUBLISHED' => 'Published', 'PAUSED' => 'Paused',
        'FAILED' => 'Failed', 'CANCELLED' => 'Cancelled', 'SKIPPED' => 'Skipped', 'MISSED' => 'Missed', 'REJECTED' => 'Rejected',
    ];

    public const TRIGGERS = ['SCHEDULE' => 'Schedule', 'MANUAL' => 'Run now', 'MANUAL_PUBLISH' => 'Manual post'];

    public static function statusLabel(?string $status): string
    {
        return self::STATUS_LABELS[$status] ?? self::label($status);
    }

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
            ->modifyQueryUsing(fn ($query) => $query->with(['automation', 'user'])->withCount('versions')
                ->addSelect(['ai_tokens' => \App\Models\AiUsageEvent::query()
                    ->selectRaw('COALESCE(SUM(prompt_tokens + completion_tokens), 0)')
                    ->where('subject_type', 'AutomationExecution')
                    ->whereColumn('subject_id', 'automation_executions.id')]))
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
                TextColumn::make('status')->badge()->formatStateUsing(fn ($state) => self::statusLabel($state))->color(fn ($state) => self::statusColor($state)),
                TextColumn::make('trigger_type')->label('Started by')->formatStateUsing(fn ($state) => self::TRIGGERS[$state] ?? 'Schedule')->placeholder('Schedule')->toggleable(),
                TextColumn::make('failure_category')->label('Failure')->formatStateUsing(fn ($state) => self::label($state))->placeholder('—')->toggleable(),
                TextColumn::make('publication_time')->label('Publishes')->dateTime('M j, H:i')->sortable()->placeholder('—'),
                TextColumn::make('published_at')->label('Published')->since()->placeholder('—')->toggleable(),
                TextColumn::make('created_at')->label('Started')->since()->sortable(),
                TextColumn::make('execution_duration_ms')->label('Took')->formatStateUsing(fn ($state) => $state === null ? '—' : ($state >= 60000 ? round($state / 60000, 1) . ' min' : round($state / 1000, 1) . ' s'))->alignEnd()->toggleable(),
                TextColumn::make('versions_count')->label('Versions')->alignCenter()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('ai_tokens')->label('AI tokens')->numeric()->alignEnd()->placeholder('—')->toggleable(),
                TextColumn::make('target_record_id')->label('Row')->prefix('#')->placeholder('—')->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('id', 'desc')
            ->filters([
                SelectFilter::make('status')->multiple()->options(collect(['QUEUED', 'GENERATING', 'REGENERATING', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'PAUSED', 'FAILED', 'MISSED', 'SKIPPED', 'CANCELLED', 'REJECTED'])
                    ->mapWithKeys(fn ($s) => [$s => self::statusLabel($s)])->all()),
                SelectFilter::make('trigger_type')->label('Started by')->options(self::TRIGGERS),
                SelectFilter::make('automation_id')->label('Automation')->relationship('automation', 'name')->searchable(),
                SelectFilter::make('user_id')->label('Customer')->relationship('user', 'name')->searchable(),
                SelectFilter::make('failure_category')->label('Failure')->options(['GENERATION_ERROR' => 'Generation error', 'TRANSACTION_ROLLBACK' => 'Write rolled back', 'MISSED_WINDOW' => 'Missed window', 'MAX_REJECTIONS_EXCEEDED' => 'Too many rejections']),
                Filter::make('started')
                    ->schema([DatePicker::make('from')->label('Started from'), DatePicker::make('until')->label('Started until')])
                    ->query(fn (Builder $query, array $data) => $query
                        ->when($data['from'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
                        ->when($data['until'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))),
            ])
            ->recordActions([
                ViewAction::make()
                    ->modalWidth('5xl')
                    ->extraModalFooterActions([
                        Action::make('openFullPage')
                            ->label('Open full page')
                            ->icon('heroicon-o-arrow-top-right-on-square')
                            ->color('gray')
                            ->url(fn (AutomationExecution $record) => RunResource::getUrl('view', ['record' => $record])),
                    ]),
            ]);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Run')
                    ->columns(4)
                    ->components([
                        TextEntry::make('status')->badge()->formatStateUsing(fn ($state) => self::statusLabel($state))->color(fn ($state) => self::statusColor($state)),
                        TextEntry::make('automation.name')->label('Automation')->placeholder('Manual publication'),
                        TextEntry::make('user.name')->label('Customer'),
                        TextEntry::make('trigger_type')->label('Started by')->formatStateUsing(fn ($state) => self::TRIGGERS[$state] ?? self::label($state))->placeholder('Schedule'),
                        TextEntry::make('writes_to')->label('Writes to')->state(fn (AutomationExecution $r) => $r->automation ? $r->automation->target_table . ($r->automation->connection ? ' in ' . $r->automation->connection->name . ' (' . $r->automation->connection->database_name . ')' : '') : null)->placeholder('—'),
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
                Section::make('AI usage')
                    ->description('Every model call this run made (writing, rewrites, images), with tokens as the provider reported them.')
                    ->columns(3)
                    ->components([
                        TextEntry::make('ai_total')->label('Tokens')->state(fn (AutomationExecution $r) => self::usage($r)['total'])->numeric(),
                        TextEntry::make('ai_calls')->label('Calls')->state(fn (AutomationExecution $r) => self::usage($r)['calls'])->numeric(),
                        TextEntry::make('ai_models')->label('Models')->state(fn (AutomationExecution $r) => collect(self::usage($r)['models'])->map(fn ($m) => ($m['model'] ?: 'unknown') . ' (' . $m['provider'] . '): ' . number_format($m['total']))->all())->listWithLineBreaks()->placeholder('No AI calls'),
                    ]),
                Section::make('Content versions')
                    ->description('Each draft of this run. A version sent back carries the reviewer\'s notes; the next version was rewritten from them.')
                    ->components([
                        RepeatableEntry::make('versions')
                            ->hiddenLabel()
                            ->schema([
                                TextEntry::make('version_number')->hiddenLabel()->prefix('Version '),
                                TextEntry::make('status')->hiddenLabel()->badge()->formatStateUsing(fn ($state) => self::statusLabel($state))->color(fn ($state) => self::statusColor($state)),
                                TextEntry::make('title')->hiddenLabel()->state(fn ($record) => \Illuminate\Support\Str::limit(strip_tags((string) ($record->payload['title'] ?? $record->payload['name'] ?? '')), 90))->placeholder('—')->columnSpan(2),
                                TextEntry::make('created_at')->hiddenLabel()->since()->color('gray'),
                                TextEntry::make('rejection_feedback')->label('Sent back with')->placeholder('—')->columnSpanFull()->visible(fn ($record) => filled($record->rejection_feedback)),
                            ])
                            ->columns(5)
                            ->placeholder('No versions yet'),
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

    /** @return array{total:int, calls:int, models:array} */
    public static function usage(AutomationExecution $run): array
    {
        static $cache = [];
        return $cache[$run->id] ??= \App\Services\AiUsage::summarize(\App\Models\AiUsageEvent::where('subject_type', 'AutomationExecution')->where('subject_id', $run->id));
    }

    public static function getPages(): array
    {
        return [
            'index' => ListRuns::route('/'),
            'view' => ViewRun::route('/{record}'),
        ];
    }
}
