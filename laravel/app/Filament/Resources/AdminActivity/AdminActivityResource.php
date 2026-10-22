<?php

namespace App\Filament\Resources\AdminActivity;

use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\AdminActivity\Pages\ListAdminActivity;
use App\Models\AdminActivityLog;
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

/** Everything admins changed in this panel (append-only; secret values are never recorded). */
class AdminActivityResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = AdminActivityLog::class;

    protected static string $permissionArea = 'audit';

    protected static ?string $modelLabel = 'admin activity';

    protected static ?string $pluralModelLabel = 'admin activity';

    protected static ?string $slug = 'admin-activity';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedFingerPrint;

    protected static string|UnitEnum|null $navigationGroup = 'Team & access';

    protected static ?string $navigationLabel = 'Admin activity';

    protected static ?int $navigationSort = 3;

    public static function action(?string $action): string
    {
        return (string) str((string) $action)->replace(['_', '.'], ' ')->ucfirst();
    }

    /** "field: from → to" lines for the table tooltip and the detail view. */
    public static function changeLines(?array $changes): array
    {
        $out = [];
        foreach ((array) $changes as $field => $change) {
            $fmt = fn ($v) => is_bool($v) ? ($v ? 'on' : 'off') : (is_array($v) ? json_encode($v) : (($v === null || $v === '') ? '—' : (string) $v));
            $out[$field] = is_array($change) && array_key_exists('to', $change)
                ? $fmt($change['from'] ?? null) . ' → ' . $fmt($change['to'])
                : $fmt($change);
        }
        return $out;
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('created_at')->label('When')->dateTime('M j, H:i:s')->sortable()->description(fn (AdminActivityLog $record) => $record->created_at?->diffForHumans()),
                TextColumn::make('admin_name')->label('Admin')->searchable(),
                TextColumn::make('action')->badge()->formatStateUsing(fn ($state) => self::action($state))
                    ->color(fn ($state) => str_contains((string) $state, 'deleted') || str_contains((string) $state, 'suspended') ? 'danger' : 'gray')
                    ->searchable(),
                TextColumn::make('subject_label')
                    ->label('On')
                    ->formatStateUsing(fn ($state, AdminActivityLog $record) => trim(($record->subject_type ? $record->subject_type . ': ' : '') . $state))
                    ->placeholder('—')
                    ->limit(60)
                    ->wrap(),
                TextColumn::make('changes')
                    ->label('Changed')
                    ->state(fn (AdminActivityLog $record) => implode(', ', array_keys((array) $record->changes)))
                    ->limit(50)
                    ->placeholder('—'),
                TextColumn::make('ip_address')->label('IP')->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('id', 'desc')
            ->filters([
                SelectFilter::make('admin_id')->label('Admin')->relationship('admin', 'name'),
                SelectFilter::make('action')
                    ->options(fn () => AdminActivityLog::query()->select('action')->distinct()->orderBy('action')->pluck('action', 'action')->map(fn ($a) => self::action($a))->all())
                    ->multiple(),
                Filter::make('when')
                    ->schema([DatePicker::make('from'), DatePicker::make('until')])
                    ->query(fn (Builder $query, array $data) => $query
                        ->when($data['from'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
                        ->when($data['until'] ?? null, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))),
            ])
            ->recordActions([ViewAction::make()->modalHeading(fn (AdminActivityLog $record) => self::action($record->action))]);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema->components([
            TextEntry::make('created_at')->label('When')->dateTime(),
            TextEntry::make('admin_name')->label('Admin'),
            TextEntry::make('subject_label')
                ->label('On')
                ->formatStateUsing(fn ($state, AdminActivityLog $record) => trim(($record->subject_type ? $record->subject_type . ': ' : '') . $state))
                ->placeholder('—'),
            TextEntry::make('ip_address')->label('IP')->placeholder('—'),
            KeyValueEntry::make('changes')
                ->label('What changed')
                ->state(fn (AdminActivityLog $record) => self::changeLines($record->changes))
                ->keyLabel('Field')
                ->valueLabel('Change')
                ->columnSpanFull(),
        ])->columns(2);
    }

    public static function getPages(): array
    {
        return ['index' => ListAdminActivity::route('/')];
    }
}
