<?php

namespace App\Filament\Resources\Connections;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Connections\Pages\ListConnections;
use App\Filament\Resources\Connections\Pages\ViewConnection;
use App\Filament\Resources\Customers\CustomerResource;
use App\Models\AuditLog;
use App\Models\DbConnection;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Infolists\Components\TextEntry;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use UnitEnum;

/**
 * Customers' database connections. Credentials are never shown. The one change an admin can make is the safe one:
 * switching a connection back to read-only (the customer can widen it again themselves).
 */
class ConnectionResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = DbConnection::class;

    protected static string $permissionArea = 'connections';

    protected static ?string $modelLabel = 'database connection';

    protected static ?string $slug = 'connections';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCircleStack;

    protected static string|UnitEnum|null $navigationGroup = 'Customers';

    protected static ?string $navigationLabel = 'Connections';

    protected static ?int $navigationSort = 2;

    protected static ?string $recordTitleAttribute = 'name';

    public const ACCESS = ['read_only' => 'Read-only', 'read_write' => 'Read & write', 'read_write_delete' => 'Read, write & delete'];

    public static function accessColor(?string $mode): string
    {
        return match ($mode) {
            'read_write' => 'warning',
            'read_write_delete' => 'danger',
            default => 'success',
        };
    }

    public static function statusColor(?string $status): string
    {
        return match ($status) {
            'connected' => 'success',
            'connection_error', 'error', 'failed' => 'danger',
            default => 'gray',
        };
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with('user'))
            ->columns([
                TextColumn::make('name')
                    ->description(fn (DbConnection $record) => strtoupper((string) $record->db_type) . ' · ' . $record->host . ':' . $record->port . ' / ' . $record->database_name)
                    ->searchable(['name', 'host', 'database_name'])
                    ->sortable(),
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->description(fn (DbConnection $record) => $record->user?->email)
                    ->url(fn (DbConnection $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null)
                    ->searchable(),
                TextColumn::make('access_mode')
                    ->label('Access')
                    ->badge()
                    ->formatStateUsing(fn ($state) => self::ACCESS[$state] ?? $state)
                    ->color(fn ($state) => self::accessColor($state)),
                TextColumn::make('status')
                    ->badge()
                    ->formatStateUsing(fn ($state) => str((string) $state)->replace('_', ' ')->ucfirst())
                    ->color(fn ($state) => self::statusColor($state)),
                TextColumn::make('last_tested_at')->label('Last tested')->since()->sortable()->placeholder('Never'),
                TextColumn::make('created_at')->label('Added')->date()->sortable()->toggleable(isToggledHiddenByDefault: true),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                SelectFilter::make('db_type')->label('Engine')->options(['mysql' => 'MySQL', 'mariadb' => 'MariaDB', 'postgresql' => 'PostgreSQL']),
                SelectFilter::make('access_mode')->label('Access')->options(self::ACCESS),
                SelectFilter::make('status')->options(['connected' => 'Connected', 'unverified' => 'Not tested', 'connection_error' => 'Connection error']),
            ])
            ->recordActions([
                ViewAction::make(),
                self::readOnlyAction(),
            ]);
    }

    public static function readOnlyAction(): Action
    {
        return Action::make('makeReadOnly')
            ->label('Set to read-only')
            ->icon('heroicon-o-lock-closed')
            ->color('warning')
            ->visible(fn (DbConnection $record) => $record->access_mode !== 'read_only' && self::adminCan('connections.update'))
            ->requiresConfirmation()
            ->modalDescription('Orbit and the data assistant can then only read this database. Automations keep writing only the rows they are configured for. The customer can widen access again in their portal.')
            ->action(function (DbConnection $record) {
                $before = $record->access_mode;
                $record->forceFill(['access_mode' => 'read_only'])->save();
                AuditLog::log($record->user_id, 'CONNECTION_SET_READ_ONLY_BY_ADMIN', 'DbConnection', (string) $record->id, ['from' => $before]);
                AdminActivity::record('connection.set_read_only', $record, ['access_mode' => ['from' => $before, 'to' => 'read_only']]);
                Notification::make()->title('Connection is now read-only')->success()->send();
            });
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Connection')
                    ->columns(4)
                    ->components([
                        TextEntry::make('name'),
                        TextEntry::make('db_type')->label('Engine')->formatStateUsing(fn ($state) => strtoupper((string) $state)),
                        TextEntry::make('host')->fontFamily('mono'),
                        TextEntry::make('port')->fontFamily('mono'),
                        TextEntry::make('database_name')->label('Database')->fontFamily('mono'),
                        TextEntry::make('ssl_mode')->label('TLS'),
                        TextEntry::make('data_timezone')->label('Timezone')->placeholder('—'),
                        TextEntry::make('credentials')->label('Password')->state('Stored encrypted, never shown'),
                    ]),
                Section::make('Health and access')
                    ->columns(4)
                    ->components([
                        TextEntry::make('status')->badge()->color(fn ($state) => self::statusColor($state)),
                        TextEntry::make('last_tested_at')->label('Last tested')->since()->placeholder('Never'),
                        TextEntry::make('server_version')->label('Server')->placeholder('—'),
                        TextEntry::make('latency_ms')->label('Latency')->suffix(' ms')->placeholder('—'),
                        TextEntry::make('access_mode')->label('Access')->badge()
                            ->formatStateUsing(fn ($state) => self::ACCESS[$state] ?? $state)->color(fn ($state) => self::accessColor($state)),
                        TextEntry::make('schema_freshness_at')->label('Schema read')->since()->placeholder('Not yet'),
                        TextEntry::make('automations_count')->label('Automations')->state(fn (DbConnection $record) => $record->automations()->count()),
                        TextEntry::make('error_message')->label('Last error')->placeholder('None')->columnSpanFull(),
                    ]),
                Section::make('Customer')
                    ->columns(3)
                    ->components([
                        TextEntry::make('user.name')->label('Name')
                            ->url(fn (DbConnection $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null),
                        TextEntry::make('user.email')->label('Email'),
                        TextEntry::make('created_at')->label('Connection added')->dateTime(),
                    ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListConnections::route('/'),
            'view' => ViewConnection::route('/{record}'),
        ];
    }
}
