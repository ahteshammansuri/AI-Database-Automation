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
            ->modifyQueryUsing(fn ($query) => $query->with('user')->withCount('toolCalls')->addSelect([
                'ai_tokens' => \App\Models\AiUsageEvent::query()->selectRaw('COALESCE(SUM(prompt_tokens + completion_tokens), 0)')
                    ->where('subject_type', 'AgentTask')->whereColumn('subject_id', 'agent_tasks.id'),
                'ai_model' => \App\Models\AiUsageEvent::query()->select('model')
                    ->where('subject_type', 'AgentTask')->whereColumn('subject_id', 'agent_tasks.id')->orderByDesc('prompt_tokens')->limit(1),
            ]))
            ->columns([
                TextColumn::make('goal')->label('Request')->limit(80)->tooltip(fn (AgentTask $record) => $record->goal)->searchable()->wrap(),
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->url(fn (AgentTask $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null),
                TextColumn::make('status')->badge()->formatStateUsing(fn ($state) => self::STATUSES[$state] ?? $state)->color(fn ($state) => self::statusColor($state)),
                TextColumn::make('tool_calls_count')->label('Tools used')->alignCenter(),
                TextColumn::make('ai_model')->label('Model')->placeholder('—')->toggleable(),
                TextColumn::make('ai_tokens')->label('Tokens')->numeric()->alignEnd()->placeholder('—')->toggleable(),
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
                Section::make('Model & tokens')
                    ->description('The model calls this request made, with tokens as the provider reported them.')
                    ->columns(3)
                    ->components([
                        TextEntry::make('ai_models')->label('Model')->state(fn (AgentTask $r) => collect(self::usage($r)['models'])->map(fn ($m) => ($m['model'] ?: 'unknown') . ' (' . $m['provider'] . ')')->all())->listWithLineBreaks()->placeholder('No model calls recorded'),
                        TextEntry::make('ai_total')->label('Tokens')->state(fn (AgentTask $r) => number_format(self::usage($r)['total']) . ' (' . number_format(self::usage($r)['prompt']) . ' sent · ' . number_format(self::usage($r)['completion']) . ' written)'),
                        TextEntry::make('ai_calls')->label('Model calls')->state(fn (AgentTask $r) => self::usage($r)['calls']),
                    ]),
                Section::make('Conversation')
                    ->description('What the customer said and what Orbit answered during this request. Passwords and keys were removed before anything was stored.')
                    ->collapsible()
                    ->components([
                        RepeatableEntry::make('conversation')
                            ->hiddenLabel()
                            ->state(fn (AgentTask $r) => self::messages($r))
                            ->schema([
                                TextEntry::make('who')->hiddenLabel()->badge()->color(fn ($state) => $state === 'Customer' ? 'gray' : 'primary'),
                                TextEntry::make('text')->hiddenLabel()->columnSpan(4),
                                TextEntry::make('at')->hiddenLabel()->dateTime('H:i:s')->color('gray'),
                            ])
                            ->columns(6)
                            ->placeholder('No messages recorded'),
                    ]),
                Section::make('What Orbit did')
                    ->description('Each tool call in order: what it did, whether it changed anything, and whether the result was checked afterwards. Arguments are stored with secrets removed.')
                    ->components([
                        RepeatableEntry::make('toolCalls')
                            ->hiddenLabel()
                            ->schema([
                                TextEntry::make('tool')->hiddenLabel()->formatStateUsing(fn ($state) => str((string) $state)->replace('_', ' ')->ucfirst())->weight('bold'),
                                TextEntry::make('status')->hiddenLabel()->badge()->color(fn ($state) => $state === 'succeeded' ? 'success' : ($state === 'failed' ? 'danger' : 'gray')),
                                TextEntry::make('outcome')->hiddenLabel()->state(fn ($record) => is_array($record->result_sanitized) ? ($record->result_sanitized['safe_message'] ?? null) : null)->placeholder('—')->columnSpan(2),
                                TextEntry::make('effects')->hiddenLabel()->state(fn ($record) => array_values(array_filter([
                                    $record->side_effect_committed ? 'Changed something' : 'Read only',
                                    $record->verified ? 'Verified' : null,
                                    $record->error_category ? str($record->error_category)->replace('_', ' ')->lower()->ucfirst()->toString() : null,
                                ])))->badge()->color('gray'),
                                TextEntry::make('started_at')->hiddenLabel()->dateTime('H:i:s')->color('gray'),
                                TextEntry::make('args_redacted')->label('Used')->state(fn ($record) => $record->args_redacted ? json_encode($record->args_redacted, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null)->fontFamily('mono')->size('xs')->color('gray')->columnSpanFull()->visible(fn ($record) => !empty($record->args_redacted)),
                            ])
                            ->columns(6)
                            ->placeholder('No tools were used'),
                    ]),
            ]);
    }

    /** @return array{prompt:int, completion:int, total:int, calls:int, models:array} */
    public static function usage(AgentTask $task): array
    {
        static $cache = [];
        return $cache[$task->id] ??= \App\Services\AiUsage::summarize(\App\Models\AiUsageEvent::where('subject_type', 'AgentTask')->where('subject_id', $task->id));
    }

    /** Messages of the request's conversation during the request (stored redacted). */
    public static function messages(AgentTask $task): array
    {
        if (!$task->conversation_id) {
            return [];
        }
        $from = $task->created_at?->copy()->subSeconds(5);
        $to = ($task->completed_at ?? $task->updated_at ?? now())->copy()->addSeconds(5);

        return \App\Models\AgentMessage::where('conversation_id', $task->conversation_id)
            ->whereBetween('created_at', [$from, $to])
            ->orderBy('id')->limit(60)->get(['role', 'content', 'created_at'])
            ->map(fn ($m) => ['who' => $m->role === 'user' ? 'Customer' : 'Orbit', 'text' => mb_substr((string) $m->content, 0, 2000), 'at' => $m->created_at])
            ->all();
    }

    public static function getPages(): array
    {
        return [
            'index' => ListOrbitTasks::route('/'),
            'view' => ViewOrbitTask::route('/{record}'),
        ];
    }
}
