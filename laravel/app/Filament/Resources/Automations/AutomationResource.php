<?php

namespace App\Filament\Resources\Automations;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Automations\Pages\ListAutomations;
use App\Filament\Resources\Automations\Pages\ViewAutomation;
use App\Filament\Resources\Automations\RelationManagers\RunsRelationManager;
use App\Filament\Resources\Customers\CustomerResource;
use App\Models\AuditLog;
use App\Models\Automation;
use App\Services\Automation\ScheduleCalculator;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use UnitEnum;

/** Customers' scheduled automations and how their runs go. Admins can pause and resume them. */
class AutomationResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = Automation::class;

    protected static string $permissionArea = 'automations';

    protected static ?string $slug = 'automations';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedArrowPath;

    protected static string|UnitEnum|null $navigationGroup = 'Customers';

    protected static ?int $navigationSort = 3;

    protected static ?string $recordTitleAttribute = 'name';

    public const MODES = ['AI_CREATE' => 'AI writes', 'AI_ENRICH' => 'AI enriches', 'MANUAL_SCHEDULE' => 'Fixed values'];

    public const SCHEDULES = ['ONE_TIME' => 'One time', 'DAILY' => 'Daily', 'WEEKLY' => 'Weekly'];

    /** Run counts for the success rate. */
    public static function runCounts(): array
    {
        return [
            'executions as published_count' => fn ($q) => $q->where('status', 'PUBLISHED'),
            'executions as failed_count' => fn ($q) => $q->where('status', 'FAILED'),
            'executions as missed_count' => fn ($q) => $q->where('status', 'MISSED'),
        ];
    }

    public static function getEloquentQuery(): Builder
    {
        // Manual-publishing containers are an internal detail, not automations the customer created.
        return parent::getEloquentQuery()
            ->where('schedule_type', '!=', ScheduleCalculator::TYPE_NONE)
            ->withCount(self::runCounts());
    }

    public static function successRate(Automation $a): ?int
    {
        $done = (int) $a->published_count + (int) $a->failed_count;
        return $done ? (int) round($a->published_count / $done * 100) : null;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with(['user', 'connection']))
            ->columns([
                TextColumn::make('name')
                    ->description(fn (Automation $record) => '→ ' . $record->target_table . ($record->connection ? ' on ' . $record->connection->name : ''))
                    ->searchable(['name', 'target_table'])
                    ->sortable()
                    ->wrap(),
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->url(fn (Automation $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null)
                    ->searchable(),
                TextColumn::make('operation_mode')->label('Content')->badge()->formatStateUsing(fn ($state) => self::MODES[$state] ?? $state)
                    ->color(fn ($state) => $state === 'MANUAL_SCHEDULE' ? 'gray' : 'primary'),
                TextColumn::make('schedule')
                    ->state(fn (Automation $record) => (self::SCHEDULES[$record->schedule_type] ?? $record->schedule_type)
                        . ' · ' . substr((string) $record->generation_time, 0, 5) . ' → ' . substr((string) $record->publication_time, 0, 5))
                    ->description(fn (Automation $record) => $record->timezone),
                TextColumn::make('state')
                    ->state(fn (Automation $record) => $record->completed_at ? 'Finished' : ($record->is_active ? 'Running' : 'Paused'))
                    ->badge()
                    ->color(fn ($state) => match ($state) { 'Running' => 'success', 'Paused' => 'warning', default => 'gray' }),
                TextColumn::make('success')
                    ->label('Run success')
                    ->state(fn (Automation $record) => self::successRate($record))
                    ->formatStateUsing(fn ($state) => $state === null ? '—' : "{$state}%")
                    ->badge()
                    ->color(fn ($state) => $state === null ? 'gray' : ($state >= 80 ? 'success' : ($state >= 50 ? 'warning' : 'danger')))
                    ->tooltip(fn (Automation $record) => "{$record->published_count} published · {$record->failed_count} failed · {$record->missed_count} missed"),
                TextColumn::make('created_at')->label('Created')->date()->sortable()->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                TernaryFilter::make('is_active')->label('Running'),
                SelectFilter::make('operation_mode')->label('Content')->options(self::MODES),
                SelectFilter::make('schedule_type')->label('Schedule')->options(self::SCHEDULES),
            ])
            ->recordActions([
                ViewAction::make()
                    ->modalWidth('5xl')
                    ->extraModalFooterActions([
                        Action::make('openFullPage')
                            ->label('Open full page')
                            ->icon('heroicon-o-arrow-top-right-on-square')
                            ->color('gray')
                            ->url(fn (Automation $record) => AutomationResource::getUrl('view', ['record' => $record])),
                    ]),
                self::pauseAction(),
                self::resumeAction(),
            ]);
    }

    public static function pauseAction(): Action
    {
        return Action::make('pause')
            ->label('Pause')
            ->icon('heroicon-o-pause')
            ->color('warning')
            ->visible(fn (Automation $record) => $record->is_active && !$record->completed_at && self::adminCan('automations.update'))
            ->requiresConfirmation()
            ->modalDescription('No new runs start until it is resumed. A run that is already generating finishes.')
            ->action(function (Automation $record) {
                $record->forceFill(['is_active' => false])->save();
                AuditLog::log($record->user_id, 'AUTOMATION_PAUSED_BY_ADMIN', 'Automation', (string) $record->id);
                AdminActivity::record('automation.paused', $record);
                Notification::make()->title('Automation paused')->success()->send();
            });
    }

    public static function resumeAction(): Action
    {
        return Action::make('resume')
            ->label('Resume')
            ->icon('heroicon-o-play')
            ->color('success')
            ->visible(fn (Automation $record) => !$record->is_active && !$record->completed_at && self::adminCan('automations.update'))
            ->requiresConfirmation()
            ->modalDescription('Runs continue from now on. Runs that would have happened while paused are not made up or reported as missed.')
            ->action(function (Automation $record) {
                // Same as a customer resuming: count runs from now (no back-fill, nothing reported missed).
                $record->forceFill(['is_active' => true, 'schedule_anchor_at' => now()])->save();
                AuditLog::log($record->user_id, 'AUTOMATION_RESUMED_BY_ADMIN', 'Automation', (string) $record->id);
                AdminActivity::record('automation.resumed', $record);
                Notification::make()->title('Automation resumed')->success()->send();
            });
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Automation')
                    ->columns(4)
                    ->components([
                        TextEntry::make('name'),
                        TextEntry::make('user.name')->label('Customer')
                            ->url(fn (Automation $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null),
                        TextEntry::make('connection.name')->label('Connection')->placeholder('—'),
                        TextEntry::make('target_table')->label('Table')->fontFamily('mono'),
                        TextEntry::make('operation_mode')->label('Content')->formatStateUsing(fn ($state) => self::MODES[$state] ?? $state)->badge(),
                        // Exactly what the next run uses (the pipeline's own resolution: automation setting, else the
                        // customer's "Writing content" model).
                        TextEntry::make('ai_provider')->label('Model')
                            ->state(function (Automation $record) {
                                if ($record->operation_mode === 'MANUAL_SCHEDULE') {
                                    return 'No AI (manual)';
                                }
                                [$provider, $model] = app(\App\Services\Automation\ContentPipeline::class)->resolveTextProvider($record);
                                return trim(($model ?: 'provider default') . ' · ' . ucfirst((string) $provider));
                            })
                            ->helperText(fn (Automation $record) => $record->ai_model ? 'Set on this automation' : 'The customer\'s "Writing content" model'),
                        IconEntry::make('requires_approval')->label('Email approval')->boolean(),
                        TextEntry::make('timeout_policy')->label('If nobody decides')->formatStateUsing(fn ($state) => str((string) $state)->replace('_', ' ')->lower()->ucfirst())->placeholder('—'),
                    ]),
                Section::make('Schedule')
                    ->columns(4)
                    ->components([
                        TextEntry::make('schedule_type')->label('Schedule')->formatStateUsing(fn ($state) => self::SCHEDULES[$state] ?? $state),
                        TextEntry::make('times')->label('Writes → publishes')
                            ->state(fn (Automation $record) => substr((string) $record->generation_time, 0, 5) . ' → ' . substr((string) $record->publication_time, 0, 5)),
                        TextEntry::make('timezone'),
                        TextEntry::make('state')
                            ->state(fn (Automation $record) => $record->completed_at ? 'Finished' : ($record->is_active ? 'Running' : 'Paused'))
                            ->badge()
                            ->color(fn ($state) => match ($state) { 'Running' => 'success', 'Paused' => 'warning', default => 'gray' }),
                        TextEntry::make('start_date')->label('From')->date()->placeholder('—'),
                        TextEntry::make('end_date')->label('Until')->date()->placeholder('No end'),
                        TextEntry::make('runs')->label('Runs so far')
                            ->state(fn (Automation $record) => "{$record->published_count} published · {$record->failed_count} failed · {$record->missed_count} missed"),
                        TextEntry::make('success')->label('Run success')
                            ->state(fn (Automation $record) => self::successRate($record))
                            ->formatStateUsing(fn ($state) => $state === null ? '—' : "{$state}%"),
                    ]),
                Section::make('Approval and results')
                    ->columns(4)
                    ->components([
                        TextEntry::make('requires_approval')->label('Approval')->formatStateUsing(fn ($state, Automation $record) => $state ? 'Required' . ($record->reviewer_email ? ' (' . $record->reviewer_email . ')' : ' (customer\'s email)') : 'Publishes without approval'),
                        TextEntry::make('last_run')->label('Last run')
                            ->state(fn (Automation $record) => ($r = $record->executions()->latest('id')->first()) ? '#' . $r->id . ' · ' . \App\Filament\Resources\Runs\RunResource::statusLabel($r->status) . ' · ' . $r->created_at?->diffForHumans() : null)
                            ->placeholder('Not run yet'),
                        TextEntry::make('documents')->label('Knowledge documents')->state(fn (Automation $record) => count((array) $record->knowledge_document_ids)),
                        TextEntry::make('tokens')->label('AI tokens, all runs')
                            ->state(fn (Automation $record) => (int) \App\Models\AiUsageEvent::where('subject_type', 'AutomationExecution')->whereIn('subject_id', $record->executions()->select('id'))->sum(\Illuminate\Support\Facades\DB::raw('prompt_tokens + completion_tokens')))
                            ->numeric(),
                        TextEntry::make('last_error')->label('Last failure')
                            ->state(fn (Automation $record) => $record->executions()->where('status', 'FAILED')->latest('id')->value('error_message'))
                            ->placeholder('None')->columnSpanFull(),
                    ]),
                Section::make('Topic')
                    ->collapsed()
                    ->components([
                        TextEntry::make('prompt_context')->hiddenLabel()->placeholder('No topic (fixed values)')->prose(),
                    ]),
            ]);
    }

    public static function getRelations(): array
    {
        return [RunsRelationManager::class];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListAutomations::route('/'),
            'view' => ViewAutomation::route('/{record}'),
        ];
    }
}
