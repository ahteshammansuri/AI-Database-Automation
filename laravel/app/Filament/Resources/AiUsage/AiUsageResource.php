<?php

namespace App\Filament\Resources\AiUsage;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\AiUsage\Pages\ListAiUsage;
use App\Filament\Resources\Customers\CustomerResource;
use App\Filament\Resources\Runs\RunResource;
use App\Models\AiUsageEvent;
use BackedEnum;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\DatePicker;
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

/** Every AI call the platform made for customers: who, which model, what for, and how many tokens (read-only). */
class AiUsageResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = AiUsageEvent::class;

    protected static string $permissionArea = 'customers';

    protected static ?string $modelLabel = 'AI call';

    protected static ?string $pluralModelLabel = 'AI usage';

    protected static ?string $slug = 'ai-usage';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCpuChip;

    protected static string|UnitEnum|null $navigationGroup = 'Customers';

    protected static ?string $navigationLabel = 'AI usage';

    protected static ?int $navigationSort = 6;

    /** What an AI call was made for, in admin words. */
    public const SUBJECTS = ['AutomationExecution' => 'Run', 'DbConnection' => 'Connection', 'AgentTask' => 'Orbit request', 'Automation' => 'Automation', 'KnowledgeDocument' => 'Document'];

    public static function canCreate(): bool
    {
        return false;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn (Builder $query) => $query->with('user:id,name,email'))
            ->columns([
                TextColumn::make('created_at')->label('When')->since()->dateTimeTooltip()->sortable(),
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->description(fn (AiUsageEvent $r) => $r->user?->email)
                    ->searchable(['name', 'email'])
                    ->url(fn (AiUsageEvent $r) => $r->user_id && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $r->user_id]) : null),
                TextColumn::make('purpose')->label('Used for')->formatStateUsing(fn (?string $state) => AiUsageEvent::purposeLabel($state))->badge()->color('gray'),
                TextColumn::make('model')
                    ->label('Model')
                    ->description(fn (AiUsageEvent $r) => ucfirst((string) $r->provider) . ($r->kind ? " · {$r->kind}" : ''))
                    ->placeholder('unknown')
                    ->searchable(),
                TextColumn::make('calls')->numeric()->alignEnd(),
                TextColumn::make('prompt_tokens')->label('Sent')->numeric()->alignEnd()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('completion_tokens')->label('Written')->numeric()->alignEnd()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('total')
                    ->label('Tokens')
                    ->tooltip(fn (AiUsageEvent $r) => number_format((int) $r->prompt_tokens) . ' sent · ' . number_format((int) $r->completion_tokens) . ' written by the model')
                    ->state(fn (AiUsageEvent $r) => (int) $r->prompt_tokens + (int) $r->completion_tokens)
                    ->numeric()
                    ->alignEnd()
                    ->weight('bold')
                    ->sortable(query: fn (Builder $query, string $direction) => $query->orderByRaw('(prompt_tokens + completion_tokens) ' . ($direction === 'desc' ? 'desc' : 'asc'))),
                TextColumn::make('subject')
                    ->label('For')
                    ->state(fn (AiUsageEvent $r) => $r->subject_type ? ((self::SUBJECTS[$r->subject_type] ?? (string) str($r->subject_type)->headline()) . ($r->subject_id ? " #{$r->subject_id}" : '')) : null)
                    ->url(fn (AiUsageEvent $r) => match (true) {
                        !$r->subject_id => null,
                        $r->subject_type === 'AutomationExecution' && RunResource::canViewAny() => RunResource::getUrl('view', ['record' => $r->subject_id]),
                        $r->subject_type === 'AgentTask' && \App\Filament\Resources\OrbitTasks\OrbitTaskResource::canViewAny() => \App\Filament\Resources\OrbitTasks\OrbitTaskResource::getUrl('view', ['record' => $r->subject_id]),
                        default => null,
                    })
                    ->placeholder('—')
                    ->toggleable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                SelectFilter::make('purpose')->label('Used for')->options(AiUsageEvent::PURPOSES),
                SelectFilter::make('provider')->options(fn () => AiUsageEvent::query()->distinct()->orderBy('provider')->pluck('provider', 'provider')->filter()->map(fn ($p) => ucfirst($p))->all()),
                SelectFilter::make('model_name')->label('Model')->attribute('model')->options(fn () => AiUsageEvent::query()->whereNotNull('model')->distinct()->orderBy('model')->pluck('model', 'model')->all())->searchable(),
                SelectFilter::make('user_id')->label('Customer')->relationship('user', 'name')->searchable()->preload(false),
                Filter::make('when')
                    ->schema([DatePicker::make('from')->label('From'), DatePicker::make('until')->label('Until')])
                    ->query(fn (Builder $query, array $data) => $query
                        ->when($data['from'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
                        ->when($data['until'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))),
            ])
            ->recordActions([
                ViewAction::make()
                    ->modalHeading('AI call details')
                    ->modalWidth('4xl'),
            ])
            ->emptyStateHeading('No AI calls yet')
            ->emptyStateDescription('Every call to a model (Orbit, automation writing, previews, sample data, images) is recorded here with its tokens.');
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('AI Call Details')
                    ->columns(3)
                    ->components([
                        TextEntry::make('purpose')->label('Used for')->formatStateUsing(fn (?string $state) => AiUsageEvent::purposeLabel($state))->badge()->color('gray'),
                        TextEntry::make('model')->label('Model')->placeholder('unknown'),
                        TextEntry::make('provider')->label('Provider')->formatStateUsing(fn ($state) => ucfirst((string) $state))->badge(),
                        TextEntry::make('calls')->label('Calls made')->numeric(),
                        TextEntry::make('prompt_tokens')->label('Prompt tokens sent')->numeric(),
                        TextEntry::make('completion_tokens')->label('Completion tokens written')->numeric(),
                        TextEntry::make('total')->label('Total tokens')->state(fn (AiUsageEvent $r) => (int) $r->prompt_tokens + (int) $r->completion_tokens)->numeric()->weight('bold'),
                        TextEntry::make('subject')->label('Associated resource')->state(fn (AiUsageEvent $r) => $r->subject_type ? ((self::SUBJECTS[$r->subject_type] ?? (string) str($r->subject_type)->headline()) . ($r->subject_id ? " #{$r->subject_id}" : '')) : 'General / unlinked'),
                        TextEntry::make('user.name')->label('Customer')->placeholder('—'),
                        TextEntry::make('created_at')->label('When')->dateTime()->placeholder('—'),
                    ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListAiUsage::route('/'),
        ];
    }
}
