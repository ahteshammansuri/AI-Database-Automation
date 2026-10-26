<?php

namespace App\Filament\Resources\Customers;

use App\Admin\CustomerAccounts;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Customers\Pages\ListCustomers;
use App\Filament\Resources\Customers\Pages\ViewCustomer;
use App\Filament\Resources\Customers\RelationManagers;
use App\Models\User;
use App\Services\Automation\ScheduleCalculator;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Infolists\Components\TextEntry;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use UnitEnum;

/**
 * Customer accounts and how they use the platform. Admins can suspend/reactivate, sign a customer out everywhere,
 * and (with customers.delete) delete an account. Customer secrets are never shown.
 */
class CustomerResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = User::class;

    protected static string $permissionArea = 'customers';

    protected static ?string $modelLabel = 'customer';

    protected static ?string $slug = 'customers';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUsers;

    protected static string|UnitEnum|null $navigationGroup = 'Customers';

    protected static ?int $navigationSort = 1;

    protected static ?string $recordTitleAttribute = 'name';

    protected static function actionPermissions(): array
    {
        return ['delete' => 'customers.delete'];
    }

    public static function getGloballySearchableAttributes(): array
    {
        return ['name', 'email'];
    }

    public static function getGlobalSearchResultDetails(Model $record): array
    {
        return ['Email' => $record->email];
    }

    public static function getNavigationBadge(): ?string
    {
        $new = User::where('created_at', '>=', now()->subDay())->count();
        return $new ? "+{$new}" : null;
    }

    public static function getNavigationBadgeTooltip(): ?string
    {
        return 'New customers in the last 24 hours';
    }

    /** Usage counts used by the table and the customer page. */
    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->withMax('tokens', 'last_used_at')->withCount([
            'connections',
            'automations' => fn ($q) => $q->where('schedule_type', '!=', ScheduleCalculator::TYPE_NONE),
            'executions as published_runs_count' => fn ($q) => $q->where('status', 'PUBLISHED'),
            'executions as failed_runs_count' => fn ($q) => $q->where('status', 'FAILED'),
            'agentTasks',
        ])
            ->withSum(['aiUsageEvents as prompt_tokens_30d' => fn ($q) => $q->where('created_at', '>=', now()->subDays(30))], 'prompt_tokens')
            ->withSum(['aiUsageEvents as completion_tokens_30d' => fn ($q) => $q->where('created_at', '>=', now()->subDays(30))], 'completion_tokens');
    }

    /** Tokens used in the last 30 days (from the list query's sums). */
    public static function tokens30d(User $user): int
    {
        return (int) $user->prompt_tokens_30d + (int) $user->completion_tokens_30d;
    }

    /** The model each role really uses for this customer, resolved exactly as the app resolves it. */
    public static function modelFor(User $user, string $role): string
    {
        $m = \App\Services\Agent\ModelSelector::for($user, $role);

        return trim(($m['model'] ?? '—') . ' · ' . ucfirst((string) ($m['provider'] ?? '')), ' ·');
    }

    /** Latest of our activity marker and Sanctum's last token use. */
    public static function lastActive(User $user): ?\Illuminate\Support\Carbon
    {
        $times = array_filter([$user->last_active_at, $user->tokens_max_last_used_at ? \Illuminate\Support\Carbon::parse($user->tokens_max_last_used_at) : null]);
        return $times ? max($times) : null;
    }

    public static function successRate(User $user): ?int
    {
        $done = (int) $user->published_runs_count + (int) $user->failed_runs_count;
        return $done ? (int) round($user->published_runs_count / $done * 100) : null;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')
                    ->description(fn (User $record) => $record->email)
                    ->searchable(['name', 'email'])
                    ->sortable(),
                TextColumn::make('status')
                    ->state(fn (User $record) => $record->isSuspended() ? 'Suspended' : 'Active')
                    ->badge()
                    ->color(fn (string $state) => $state === 'Active' ? 'success' : 'danger'),
                TextColumn::make('connections_count')->label('Connections')->sortable()->alignCenter(),
                TextColumn::make('automations_count')->label('Automations')->sortable()->alignCenter(),
                TextColumn::make('success')
                    ->label('Run success')
                    ->state(fn (User $record) => self::successRate($record))
                    ->formatStateUsing(fn ($state) => $state === null ? '—' : "{$state}%")
                    ->badge()
                    ->color(fn ($state) => $state === null ? 'gray' : ($state >= 80 ? 'success' : ($state >= 50 ? 'warning' : 'danger')))
                    ->tooltip(fn (User $record) => "{$record->published_runs_count} published · {$record->failed_runs_count} failed"),
                TextColumn::make('agent_tasks_count')->label('Orbit requests')->sortable()->alignCenter()->toggleable(),
                TextColumn::make('tokens_30d')
                    ->label('AI tokens (30 days)')
                    ->state(fn (User $record) => self::tokens30d($record))
                    ->numeric()
                    ->alignEnd()
                    ->sortable(query: fn (Builder $query, string $direction) => $query->orderByRaw('(COALESCE(prompt_tokens_30d, 0) + COALESCE(completion_tokens_30d, 0)) ' . ($direction === 'desc' ? 'desc' : 'asc')))
                    ->tooltip(fn (User $record) => number_format((int) $record->prompt_tokens_30d) . ' sent · ' . number_format((int) $record->completion_tokens_30d) . ' written by the model'),
                TextColumn::make('writing_model')
                    ->label('Writing model')
                    ->state(fn (User $record) => self::modelFor($record, \App\Models\ModelRole::ROLE_GENERATOR))
                    ->description(fn (User $record) => 'Orbit: ' . self::modelFor($record, \App\Models\ModelRole::ROLE_PLANNER))
                    ->toggleable(),
                TextColumn::make('last_active_at')
                    ->label('Last active')
                    ->state(fn (User $record) => self::lastActive($record))
                    ->since()
                    ->sortable()
                    ->placeholder('Not yet'),
                TextColumn::make('created_at')->label('Joined')->date()->sortable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                SelectFilter::make('state')
                    ->label('Status')
                    ->options(['active' => 'Active', 'suspended' => 'Suspended'])
                    ->query(fn (Builder $query, array $data) => match ($data['value'] ?? null) {
                        'active' => $query->whereNull('suspended_at'),
                        'suspended' => $query->whereNotNull('suspended_at'),
                        default => $query,
                    }),
                TernaryFilter::make('has_connections')
                    ->label('Has a database connection')
                    ->queries(true: fn (Builder $query) => $query->has('connections'), false: fn (Builder $query) => $query->doesntHave('connections')),
                Filter::make('joined')
                    ->schema([DatePicker::make('from')->label('Joined from'), DatePicker::make('until')->label('Joined until')])
                    ->query(fn (Builder $query, array $data) => $query
                        ->when($data['from'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
                        ->when($data['until'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))),
            ])
            ->recordActions([
                ViewAction::make(),
                ActionGroup::make(self::accountActions()),
            ]);
    }

    /** Suspend / reactivate / sign out / delete: shared by the table and the customer page. */
    public static function accountActions(): array
    {
        return [
            Action::make('suspend')
                ->label('Suspend')
                ->icon('heroicon-o-no-symbol')
                ->color('danger')
                ->visible(fn (User $record) => !$record->isSuspended() && self::adminCan('customers.update'))
                ->schema([
                    Textarea::make('reason')
                        ->label('Reason (kept in the audit log)')
                        ->required()
                        ->maxLength(500)
                        ->rows(3),
                ])
                ->modalDescription('The customer is signed out everywhere, their paired phone is disconnected, and they cannot sign in until reactivated. Their automations keep their settings.')
                ->modalSubmitActionLabel('Suspend account')
                ->action(function (User $record, array $data) {
                    app(CustomerAccounts::class)->suspend($record, $data['reason']);
                    Notification::make()->title('Account suspended')->success()->send();
                }),
            Action::make('reactivate')
                ->label('Reactivate')
                ->icon('heroicon-o-check-circle')
                ->color('success')
                ->visible(fn (User $record) => $record->isSuspended() && self::adminCan('customers.update'))
                ->requiresConfirmation()
                ->action(function (User $record) {
                    app(CustomerAccounts::class)->reactivate($record);
                    Notification::make()->title('Account reactivated')->success()->send();
                }),
            Action::make('signOut')
                ->label('Sign out everywhere')
                ->icon('heroicon-o-arrow-right-start-on-rectangle')
                ->visible(fn () => self::adminCan('customers.update'))
                ->requiresConfirmation()
                ->modalDescription('Ends every portal session and disconnects a paired phone. The customer can sign in again.')
                ->action(function (User $record) {
                    $n = app(CustomerAccounts::class)->signOutEverywhere($record);
                    Notification::make()->title("Signed out of {$n} session" . ($n === 1 ? '' : 's'))->success()->send();
                }),
            Action::make('deleteAccount')
                ->label('Delete account')
                ->icon('heroicon-o-trash')
                ->color('danger')
                ->visible(fn (User $record) => self::canDelete($record))
                ->schema([
                    TextInput::make('confirm_email')
                        ->label(fn (User $record) => "Type {$record->email} to confirm")
                        ->required()
                        ->in(fn (User $record) => [$record->email])
                        ->validationMessages(['in' => 'Type the customer\'s email exactly to confirm.']),
                ])
                ->modalDescription('Permanently deletes the account with its connections, automations, runs, documents, uploads and Orbit history. Their own databases are not touched. This cannot be undone.')
                ->modalSubmitActionLabel('Delete permanently')
                ->action(function (User $record, $livewire) {
                    app(CustomerAccounts::class)->delete($record);
                    Notification::make()->title('Account deleted')->success()->send();
                    if ($livewire instanceof ViewCustomer) {
                        $livewire->redirect(self::getUrl('index'));
                    }
                }),
        ];
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Account')
                    ->columns(4)
                    ->components([
                        TextEntry::make('name'),
                        TextEntry::make('email')->label('Email')->copyable(),
                        TextEntry::make('status')
                            ->state(fn (User $record) => $record->isSuspended() ? 'Suspended' : 'Active')
                            ->badge()
                            ->color(fn (string $state) => $state === 'Active' ? 'success' : 'danger'),
                        TextEntry::make('timezone')->placeholder('Not set'),
                        TextEntry::make('created_at')->label('Joined')->dateTime(),
                        TextEntry::make('last_active_at')->label('Last active')->state(fn (User $record) => self::lastActive($record))->since()->placeholder('Not yet'),
                        TextEntry::make('suspended_at')->label('Suspended')->dateTime()->visible(fn (User $record) => $record->isSuspended()),
                        TextEntry::make('suspension_reason')->label('Reason')->visible(fn (User $record) => $record->isSuspended())->columnSpan(2),
                    ]),
                Section::make('AI models & tokens')
                    ->description('The models this customer\'s requests use, and the tokens recorded for every AI call. Local models cost nothing; cloud providers bill the customer\'s own key.')
                    ->columns(4)
                    ->components([
                        TextEntry::make('planner_model')->label('Orbit and planning')->state(fn (User $record) => self::modelFor($record, \App\Models\ModelRole::ROLE_PLANNER)),
                        TextEntry::make('generator_model')->label('Writing content')->state(fn (User $record) => self::modelFor($record, \App\Models\ModelRole::ROLE_GENERATOR)),
                        TextEntry::make('tokens_30d_total')
                            ->label('Tokens, last 30 days')
                            ->state(function (User $record) {
                                $u = \App\Services\AiUsage::summarize($record->aiUsageEvents()->where('created_at', '>=', now()->subDays(30))->getQuery());
                                return number_format($u['total']) . ' in ' . number_format($u['calls']) . ' ' . str('call')->plural($u['calls']);
                            }),
                        TextEntry::make('tokens_all')
                            ->label('Tokens, all time')
                            ->state(fn (User $record) => (int) $record->aiUsageEvents()->sum(\Illuminate\Support\Facades\DB::raw('prompt_tokens + completion_tokens')))
                            ->numeric(),
                        TextEntry::make('by_model')
                            ->label('By model (30 days)')
                            ->columnSpan(2)
                            ->state(fn (User $record) => collect(\App\Services\AiUsage::summarize($record->aiUsageEvents()->where('created_at', '>=', now()->subDays(30))->getQuery())['models'])
                                ->map(fn ($m) => ($m['model'] ?: 'unknown') . ' (' . $m['provider'] . '): ' . number_format($m['total']) . ' tokens · ' . $m['calls'] . ' calls')->all())
                            ->listWithLineBreaks()
                            ->placeholder('No AI calls yet'),
                        TextEntry::make('by_purpose')
                            ->label('By purpose (30 days)')
                            ->columnSpan(2)
                            ->state(fn (User $record) => $record->aiUsageEvents()->where('created_at', '>=', now()->subDays(30))
                                ->selectRaw('purpose, SUM(calls) calls, SUM(prompt_tokens) + SUM(completion_tokens) tokens')->groupBy('purpose')->orderByDesc('tokens')->get()
                                ->map(fn ($r) => \App\Models\AiUsageEvent::purposeLabel($r->purpose) . ': ' . number_format((int) $r->tokens) . ' tokens · ' . (int) $r->calls . ' calls')->all())
                            ->listWithLineBreaks()
                            ->placeholder('No AI calls yet'),
                    ]),
                Section::make('Usage')
                    ->columns(4)
                    ->components([
                        TextEntry::make('connections_count')->label('Database connections'),
                        TextEntry::make('automations_count')->label('Automations'),
                        TextEntry::make('runs')
                            ->label('Automation runs')
                            ->state(fn (User $record) => "{$record->published_runs_count} published · {$record->failed_runs_count} failed"),
                        TextEntry::make('success')
                            ->label('Run success')
                            ->state(fn (User $record) => self::successRate($record))
                            ->formatStateUsing(fn ($state) => $state === null ? '—' : "{$state}%")
                            ->badge()
                            ->color(fn ($state) => $state === null ? 'gray' : ($state >= 80 ? 'success' : ($state >= 50 ? 'warning' : 'danger'))),
                        TextEntry::make('agent_tasks_count')->label('Orbit requests'),
                        TextEntry::make('documents')->label('Knowledge documents')->state(fn (User $record) => $record->knowledgeDocuments()->count()),
                        TextEntry::make('providers')
                            ->label('AI providers')
                            ->state(fn (User $record) => $record->aiProviders()->pluck('provider_type')->map(fn ($p) => ucfirst($p))->join(', ') ?: 'Local Ollama only'),
                        TextEntry::make('phones')
                            ->label('Phone connected')
                            ->state(fn (User $record) => $record->remoteSessions()->where('status', 'active')->value('device_label') ?? 'No'),
                    ]),
            ]);
    }

    public static function getRelations(): array
    {
        return [
            RelationManagers\ConnectionsRelationManager::class,
            RelationManagers\AutomationsRelationManager::class,
            RelationManagers\RunsRelationManager::class,
            RelationManagers\OrbitTasksRelationManager::class,
            RelationManagers\AiUsageRelationManager::class,
            RelationManagers\AiProvidersRelationManager::class,
            RelationManagers\KnowledgeDocumentsRelationManager::class,
            RelationManagers\ActivityRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListCustomers::route('/'),
            'view' => ViewCustomer::route('/{record}'),
        ];
    }
}
