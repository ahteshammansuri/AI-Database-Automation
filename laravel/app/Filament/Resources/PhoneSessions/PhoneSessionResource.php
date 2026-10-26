<?php

namespace App\Filament\Resources\PhoneSessions;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\Customers\CustomerResource;
use App\Filament\Resources\PhoneSessions\Pages\ListPhoneSessions;
use App\Models\OrbitRemoteSession;
use App\Services\Orbit\OrbitRemoteService;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use UnitEnum;

/** Phones paired with Orbit Remote. An admin can disconnect one; pairing codes and tokens are never shown. */
class PhoneSessionResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = OrbitRemoteSession::class;

    protected static string $permissionArea = 'orbit';

    protected static ?string $modelLabel = 'phone session';

    protected static ?string $slug = 'phone-sessions';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedDevicePhoneMobile;

    protected static string|UnitEnum|null $navigationGroup = 'Orbit';

    protected static ?string $navigationLabel = 'Paired phones';

    protected static ?int $navigationSort = 2;

    public static function getNavigationBadge(): ?string
    {
        $active = OrbitRemoteSession::where('status', 'active')->count();
        return $active ?: null;
    }

    public static function getNavigationBadgeTooltip(): ?string
    {
        return 'Phones connected right now';
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with('user'))
            ->columns([
                TextColumn::make('user.name')
                    ->label('Customer')
                    ->description(fn (OrbitRemoteSession $record) => $record->user?->email)
                    ->url(fn (OrbitRemoteSession $record) => $record->user && CustomerResource::canViewAny() ? CustomerResource::getUrl('view', ['record' => $record->user]) : null)
                    ->searchable(),
                TextColumn::make('device_label')->label('Phone')->placeholder('Not scanned yet'),
                TextColumn::make('desktop_label')->label('Computer')->placeholder('—'),
                TextColumn::make('status')->badge()
                    ->formatStateUsing(fn ($state) => match ($state) { 'active' => 'Connected', 'pending' => 'Waiting for scan', default => 'Ended' })
                    ->color(fn ($state) => match ($state) { 'active' => 'success', 'pending' => 'warning', default => 'gray' }),
                TextColumn::make('last_device_seen_at')->label('Phone last seen')->since()->placeholder('—'),
                TextColumn::make('end_reason')->label('Ended because')->formatStateUsing(fn ($state) => str((string) $state)->replace('_', ' ')->ucfirst())->placeholder('—')->toggleable(),
                TextColumn::make('commands_count')->label('Commands')->alignCenter()->toggleable(),
                TextColumn::make('created_at')->label('Started')->since()->sortable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                SelectFilter::make('status')->options(['active' => 'Connected', 'pending' => 'Waiting for scan', 'ended' => 'Ended']),
            ])
            ->modifyQueryUsing(fn ($query) => $query->withCount('commands'))
            ->recordActions([
                ViewAction::make(),
                Action::make('disconnect')
                    ->label('Disconnect')
                    ->icon('heroicon-o-link-slash')
                    ->color('danger')
                    ->visible(fn (OrbitRemoteSession $record) => $record->status !== 'ended' && self::adminCan('orbit.manage'))
                    ->requiresConfirmation()
                    ->modalDescription('The phone stops working with Orbit right away and shows that an administrator disconnected it.')
                    ->action(function (OrbitRemoteSession $record) {
                        app(OrbitRemoteService::class)->end($record, 'disconnected_by_admin', request()->ip());
                        AdminActivity::record('phone.disconnected', $record, [], $record->device_label ?: 'Phone session');
                        Notification::make()->title('Phone disconnected')->success()->send();
                    }),
            ]);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Session')
                    ->columns(4)
                    ->components([
                        TextEntry::make('user.name')->label('Customer'),
                        TextEntry::make('status')->badge()->formatStateUsing(fn ($state) => ['active' => 'Connected', 'pending' => 'Waiting for scan', 'ended' => 'Ended'][$state] ?? $state)
                            ->color(fn ($state) => $state === 'active' ? 'success' : ($state === 'pending' ? 'warning' : 'gray')),
                        TextEntry::make('device_label')->label('Phone')->placeholder('Not scanned yet'),
                        TextEntry::make('desktop_label')->label('Computer')->placeholder('—'),
                        TextEntry::make('created_at')->label('Pairing started')->dateTime(),
                        TextEntry::make('claimed_at')->label('Phone paired')->dateTime()->placeholder('Not paired'),
                        TextEntry::make('last_device_seen_at')->label('Phone last seen')->since()->placeholder('—'),
                        TextEntry::make('last_desktop_seen_at')->label('Computer last seen')->since()->placeholder('—'),
                        TextEntry::make('expires_at')->label('Expires')->dateTime()->placeholder('—'),
                        TextEntry::make('ended_at')->label('Ended')->dateTime()->placeholder('Still open'),
                        TextEntry::make('end_reason')->label('Ended because')->formatStateUsing(fn ($state) => str((string) $state)->replace('_', ' ')->ucfirst())->placeholder('—'),
                    ]),
                Section::make('Commands from the phone')
                    ->description('What was sent to Orbit from this phone, in order, and what happened to each.')
                    ->components([
                        RepeatableEntry::make('commands')
                            ->hiddenLabel()
                            ->schema([
                                TextEntry::make('kind')->hiddenLabel()->badge()->color('gray'),
                                TextEntry::make('text')->hiddenLabel()->limit(200)->placeholder('—')->columnSpan(3),
                                TextEntry::make('status')->hiddenLabel()->badge()->color(fn ($state) => in_array($state, ['received', 'delivered', 'done', 'accepted'], true) ? 'success' : ($state === 'refused' || $state === 'failed' ? 'danger' : 'gray')),
                                TextEntry::make('reason')->hiddenLabel()->placeholder('—'),
                                TextEntry::make('received_at')->hiddenLabel()->dateTime('M j, H:i:s')->color('gray'),
                            ])
                            ->columns(7)
                            ->placeholder('No commands were sent'),
                    ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListPhoneSessions::route('/'),
            'view' => Pages\ViewPhoneSession::route('/{record}'),
        ];
    }
}
