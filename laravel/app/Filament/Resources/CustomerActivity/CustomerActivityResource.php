<?php

namespace App\Filament\Resources\CustomerActivity;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Customers\CustomerResource;
use App\Filament\Resources\CustomerActivity\Pages\ListCustomerActivity;
use App\Models\AuditLog;
use BackedEnum;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\DatePicker;
use Filament\Infolists\Components\KeyValueEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use UnitEnum;

/** The customers' audit trail (sign-ins, connections, automations, publishing, Orbit, admin actions on accounts). */
class CustomerActivityResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = AuditLog::class;

    protected static string $permissionArea = 'audit';

    protected static ?string $modelLabel = 'activity entry';

    protected static ?string $pluralModelLabel = 'customer activity';

    protected static ?string $slug = 'customer-activity';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClipboardDocumentList;

    protected static string|UnitEnum|null $navigationGroup = 'Customers';

    protected static ?string $navigationLabel = 'Activity log';

    protected static ?int $navigationSort = 5;

    public static function action(?string $action): string
    {
        return (string) str((string) $action)->replace(['_', '.'], ' ')->lower()->ucfirst();
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with('user'))
            ->columns([
                TextColumn::make('created_at')->label('When')->dateTime('M j, H:i:s')->sortable()->description(fn (AuditLog $record) => $record->created_at?->diffForHumans()),
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->placeholder('Deleted account')
                    ->url(fn (AuditLog $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null),
                TextColumn::make('what')
                    ->label('What happened')
                    ->state(fn (AuditLog $record) => \App\Admin\AuditDescriber::describe($record))
                    ->description(fn (AuditLog $record) => ($n = count(\App\Admin\AuditDescriber::changes($record))) ? "{$n} field" . ($n === 1 ? '' : 's') . ' changed' : null)
                    ->wrap(),
                TextColumn::make('action')->badge()->formatStateUsing(fn ($state) => self::action($state))
                    ->color(fn ($state) => preg_match('/DELETED|SUSPENDED|refused|MISSED|mismatch/i', (string) $state) ? 'danger' : (str_contains((string) $state, 'ADMIN') ? 'warning' : 'gray'))
                    ->searchable()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('resource_type')->label('On')->formatStateUsing(fn ($state, AuditLog $record) => trim($state . ($record->resource_id ? " #{$record->resource_id}" : '')))->placeholder('—'),
                TextColumn::make('ip_address')->label('IP')->placeholder('—')->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('id', 'desc')
            ->filters([
                SelectFilter::make('category')
                    ->label('Area')
                    ->options(['connections' => 'Connections', 'automations' => 'Automations', 'approvals' => 'Approvals', 'data' => 'Data', 'ai' => 'AI & knowledge', 'account' => 'Account', 'orbit' => 'Orbit'])
                    ->query(fn (Builder $query, array $data) => $query->when($data['value'] ?? null, fn ($q, $cat) => $q->where(function ($w) use ($cat) {
                        foreach (\App\Http\Controllers\Api\AuditLogController::CATEGORIES[$cat] ?? [] as $pattern) {
                            $w->orWhere('action', 'like', $pattern);
                        }
                    }))),
                SelectFilter::make('user_id')->label('Customer')->relationship('user', 'name')->searchable(),
                SelectFilter::make('action')
                    ->options(fn () => AuditLog::query()->select('action')->distinct()->orderBy('action')->pluck('action', 'action')->map(fn ($a) => self::action($a))->all())
                    ->searchable()
                    ->multiple(),
                Filter::make('when')
                    ->schema([DatePicker::make('from'), DatePicker::make('until')])
                    ->query(fn (Builder $query, array $data) => $query
                        ->when($data['from'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
                        ->when($data['until'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))),
            ])
            ->recordActions([
                ViewAction::make()
                    ->modalHeading(fn (AuditLog $record) => \App\Admin\AuditDescriber::describe($record))
                    ->modalWidth('4xl'),
            ]);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema->components([
            TextEntry::make('created_at')->label('When')->dateTime(),
            TextEntry::make('user.name')->label('Customer')->placeholder('Deleted account'),
            TextEntry::make('resource_type')->label('On')->formatStateUsing(fn ($state, ?AuditLog $record = null) => trim($state . ($record?->resource_id ? " #{$record->resource_id}" : '')))->placeholder('—'),
            TextEntry::make('ip_address')->label('IP')->placeholder('—'),
            TextEntry::make('what')->label('What happened')->state(fn (?AuditLog $record = null) => $record ? \App\Admin\AuditDescriber::describe($record) : null)->columnSpanFull(),
            TextEntry::make('changes')
                ->label('What changed')
                ->state(fn (?AuditLog $record = null) => $record ? \App\Admin\AuditDescriber::changes($record) : [])
                ->listWithLineBreaks()
                ->columnSpanFull()
                ->visible(fn (?AuditLog $record = null) => $record && \App\Admin\AuditDescriber::changes($record) !== []),
            KeyValueEntry::make('metadata')
                ->label('Details')
                ->state(fn (?AuditLog $record = null) => $record ? collect((array) $record->metadata)->except('changes')->map(fn ($v) => is_scalar($v) || $v === null ? (string) $v : json_encode($v))->all() : [])
                ->columnSpanFull(),
        ])->columns(2);
    }

    public static function getPages(): array
    {
        return ['index' => ListCustomerActivity::route('/')];
    }
}
