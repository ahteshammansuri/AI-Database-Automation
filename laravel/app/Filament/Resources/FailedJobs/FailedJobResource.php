<?php

namespace App\Filament\Resources\FailedJobs;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\FailedJobs\Pages\ListFailedJobs;
use App\Models\FailedJob;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Artisan;
use UnitEnum;

/**
 * Background jobs that failed. Retrying is safe: every platform job checks the current state first, so a finished
 * run or a replaced Orbit turn is skipped.
 */
class FailedJobResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = FailedJob::class;

    protected static string $permissionArea = 'system';

    protected static ?string $modelLabel = 'failed job';

    protected static ?string $slug = 'failed-jobs';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedExclamationTriangle;

    protected static string|UnitEnum|null $navigationGroup = 'System';

    protected static ?string $navigationLabel = 'Failed jobs';

    protected static ?int $navigationSort = 2;

    private const RETRY_NOTE = 'The job runs again with the same data. Jobs check the current state first, so a run that already finished or an Orbit turn that was replaced is skipped.';

    public static function getNavigationBadge(): ?string
    {
        $recent = FailedJob::where('failed_at', '>=', now()->subDay())->count();
        return $recent ?: null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'danger';
    }

    public static function getNavigationBadgeTooltip(): ?string
    {
        return 'Failed in the last 24 hours';
    }

    /** @param iterable<FailedJob> $jobs */
    private static function retry(iterable $jobs): int
    {
        $ids = collect($jobs)->pluck('uuid')->filter()->values()->all();
        if ($ids) {
            Artisan::call('queue:retry', ['id' => $ids]);
            AdminActivity::record('system.failed_jobs_retried', 'Failed jobs', ['jobs' => count($ids)]);
        }
        return count($ids);
    }

    /** @param iterable<FailedJob> $jobs */
    private static function forget(iterable $jobs): int
    {
        $n = 0;
        foreach ($jobs as $job) {
            $n += Artisan::call('queue:forget', ['id' => $job->uuid]) === 0 ? 1 : 0;
        }
        AdminActivity::record('system.failed_jobs_deleted', 'Failed jobs', ['jobs' => $n]);
        return $n;
    }

    public static function table(Table $table): Table
    {
        $manage = fn () => self::adminCan('system.manage');

        return $table
            ->defaultSort('failed_at', 'desc')
            ->columns([
                TextColumn::make('failed_at')->label('Failed')->dateTime('M j, H:i:s')->description(fn (FailedJob $record) => $record->failed_at?->diffForHumans())->sortable(),
                TextColumn::make('job')->label('Job')->state(fn (FailedJob $record) => $record->jobName())->weight('medium'),
                TextColumn::make('queue')->badge()->color('gray'),
                TextColumn::make('error')->label('Error')->state(fn (FailedJob $record) => $record->errorLine())->limit(110)->tooltip(fn (FailedJob $record) => $record->errorLine())->wrap(),
            ])
            ->filters([
                SelectFilter::make('queue')->options(fn () => FailedJob::query()->distinct()->orderBy('queue')->pluck('queue', 'queue')->all()),
            ])
            ->emptyStateIcon(Heroicon::OutlinedCheckCircle)
            ->emptyStateHeading('No failed jobs')
            ->emptyStateDescription('Every background job finished.')
            ->recordActions([
                Action::make('retry')
                    ->label('Retry')
                    ->icon('heroicon-o-arrow-path')
                    ->visible($manage)
                    ->requiresConfirmation()
                    ->modalDescription(self::RETRY_NOTE)
                    ->action(function (FailedJob $record) {
                        self::retry([$record]);
                        Notification::make()->title('Job sent back to the queue')->success()->send();
                    }),
                Action::make('forget')
                    ->label('Delete')
                    ->icon('heroicon-o-trash')
                    ->color('danger')
                    ->visible($manage)
                    ->requiresConfirmation()
                    ->modalDescription('The record of this failure is removed. The job does not run again.')
                    ->action(function (FailedJob $record) {
                        self::forget([$record]);
                        Notification::make()->title('Failed job deleted')->success()->send();
                    }),
            ])
            ->toolbarActions([
                BulkAction::make('retrySelected')
                    ->label('Retry selected')
                    ->icon('heroicon-o-arrow-path')
                    ->visible($manage)
                    ->requiresConfirmation()
                    ->modalDescription(self::RETRY_NOTE)
                    ->action(function (Collection $records) {
                        $n = self::retry($records);
                        Notification::make()->title("{$n} " . str('job')->plural($n) . ' sent back to the queue')->success()->send();
                    })
                    ->deselectRecordsAfterCompletion(),
                BulkAction::make('forgetSelected')
                    ->label('Delete selected')
                    ->icon('heroicon-o-trash')
                    ->color('danger')
                    ->visible($manage)
                    ->requiresConfirmation()
                    ->modalDescription('The records of these failures are removed. The jobs do not run again.')
                    ->action(function (Collection $records) {
                        $n = self::forget($records);
                        Notification::make()->title("{$n} failed " . str('job')->plural($n) . ' deleted')->success()->send();
                    })
                    ->deselectRecordsAfterCompletion(),
            ]);
    }

    public static function getPages(): array
    {
        return ['index' => ListFailedJobs::route('/')];
    }
}
