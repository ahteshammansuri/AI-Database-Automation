<?php

namespace App\Filament\Resources\OrbitSurfaces;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\OrbitSurfaces\Pages\CreateOrbitSurface;
use App\Filament\Resources\OrbitSurfaces\Pages\EditOrbitSurface;
use App\Filament\Resources\OrbitSurfaces\Pages\ListOrbitSurfaces;
use App\Models\OrbitPage;
use App\Models\OrbitSurface;
use App\Services\Agent\SurfaceCatalog;
use BackedEnum;
use Filament\Actions\DeleteAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use UnitEnum;

/**
 * Manage on-screen interactive surfaces (cards, forms, dialogs, inputs, buttons)
 * dynamically from the Filament Admin Panel. Live immediately for Orbit navigation and operations.
 */
class OrbitSurfaceResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = OrbitSurface::class;

    protected static string $permissionArea = 'orbit_knowledge';

    protected static ?string $modelLabel = 'surface';

    protected static ?string $pluralModelLabel = 'Surfaces & Forms';

    protected static ?string $slug = 'orbit-surfaces';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedSquare3Stack3d;

    protected static string|UnitEnum|null $navigationGroup = 'Orbit';

    protected static ?string $navigationLabel = 'Surfaces & Forms';

    protected static ?int $navigationSort = 5;

    protected static ?string $recordTitleAttribute = 'title';

    protected static function actionPermissions(): array
    {
        $manage = 'orbit_knowledge.manage';
        return ['create' => $manage, 'update' => $manage, 'delete' => $manage, 'reorder' => $manage];
    }

    public static function form(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Surface Identity & Location')
                    ->columns(3)
                    ->components([
                        TextInput::make('id')
                            ->label('Surface ID')
                            ->required()
                            ->maxLength(120)
                            ->unique(ignoreRecord: true)
                            ->disabled(fn (?OrbitSurface $record) => $record !== null)
                            ->helperText('Unique technical key, e.g. account.profile, connections.new'),
                        Select::make('route')
                            ->label('Portal Page Route')
                            ->options(fn () => OrbitPage::orderBy('sort')->pluck('title', 'route')->map(fn ($title, $route) => "{$title} ({$route})")->all())
                            ->searchable()
                            ->required(),
                        TextInput::make('title')
                            ->label('Surface Title')
                            ->required()
                            ->maxLength(160),
                        Toggle::make('openable')
                            ->label('Popup / Modal Form')
                            ->helperText('Enable if this is a dialog that opens via an opener button.')
                            ->default(false),
                        Toggle::make('is_active')
                            ->label('Active in Orbit')
                            ->default(true),
                        TextInput::make('sort')
                            ->label('Sort Order')
                            ->numeric()
                            ->default(10),
                        Textarea::make('purpose')
                            ->label('Purpose & Operational Instructions')
                            ->helperText('Explains to Orbit what this surface is for, what fields it takes, and what actions it executes.')
                            ->rows(3)
                            ->columnSpanFull(),
                    ]),

                Section::make('Form Fields')
                    ->description('Interactive input fields on this surface that Orbit can inspect or type into.')
                    ->components([
                        Repeater::make('fields')
                            ->hiddenLabel()
                            ->columns(6)
                            ->components([
                                TextInput::make('name')
                                    ->label('Field Key')
                                    ->required()
                                    ->maxLength(64)
                                    ->columnSpan(2),
                                TextInput::make('label')
                                    ->label('Display Label')
                                    ->columnSpan(2),
                                Select::make('type')
                                    ->label('Field Type')
                                    ->options([
                                        'text' => 'Text input',
                                        'email' => 'Email',
                                        'password' => 'Password (secret)',
                                        'secret' => 'API Secret / Key',
                                        'select' => 'Dropdown (select)',
                                        'searchable_select' => 'Searchable Select',
                                        'textarea' => 'Textarea',
                                        'checkbox' => 'Checkbox toggle',
                                        'file' => 'File picker',
                                        'number' => 'Number',
                                    ])
                                    ->default('text')
                                    ->native(false)
                                    ->columnSpan(2),
                                Toggle::make('required')->label('Required')->inline(false),
                                Toggle::make('dynamic')->label('Dynamic Column')->inline(false),
                                Toggle::make('row')->label('Row-specific')->inline(false),
                            ])
                            ->defaultItems(0)
                            ->addActionLabel('Add Field')
                            ->collapsible()
                            ->cloneable(),
                    ]),

                Section::make('Buttons & Actions')
                    ->description('Clickable actions and buttons on this surface that Orbit can press.')
                    ->components([
                        Repeater::make('actions')
                            ->hiddenLabel()
                            ->columns(6)
                            ->components([
                                TextInput::make('id')
                                    ->label('Action ID')
                                    ->required()
                                    ->maxLength(64)
                                    ->helperText('e.g. save, test, delete, submit')
                                    ->columnSpan(2),
                                TextInput::make('label')
                                    ->label('Button Label')
                                    ->columnSpan(2),
                                TextInput::make('timeout_s')
                                    ->label('Timeout (seconds)')
                                    ->numeric()
                                    ->default(30)
                                    ->columnSpan(2),
                                Toggle::make('consequential')->label('Consequential (asks user)')->inline(false),
                                Toggle::make('destructive')->label('Destructive (guarded)')->inline(false),
                                Toggle::make('row')->label('Row Action')->inline(false),
                            ])
                            ->defaultItems(0)
                            ->addActionLabel('Add Action')
                            ->collapsible()
                            ->cloneable(),
                    ]),
            ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('sort')
            ->columns([
                TextColumn::make('id')
                    ->label('Surface ID')
                    ->searchable()
                    ->weight('bold'),
                TextColumn::make('route')
                    ->label('Page')
                    ->badge()
                    ->color('info')
                    ->searchable(),
                TextColumn::make('title')
                    ->label('Title')
                    ->searchable(),
                TextColumn::make('fields_count')
                    ->label('Fields')
                    ->state(fn (OrbitSurface $record) => count((array) ($record->fields ?? [])))
                    ->badge()
                    ->alignCenter(),
                TextColumn::make('actions_count')
                    ->label('Actions')
                    ->state(fn (OrbitSurface $record) => count((array) ($record->actions ?? [])))
                    ->badge()
                    ->alignCenter(),
                IconColumn::make('openable')
                    ->label('Popup')
                    ->boolean()
                    ->alignCenter(),
                IconColumn::make('is_active')
                    ->label('Active')
                    ->boolean()
                    ->alignCenter(),
                TextColumn::make('updated_at')
                    ->label('Edited')
                    ->since()
                    ->sortable(),
            ])
            ->filters([
                SelectFilter::make('route')
                    ->label('Filter by page')
                    ->options(fn () => OrbitPage::pluck('title', 'route')->all()),
            ])
            ->emptyStateIcon(Heroicon::OutlinedSquare3Stack3d)
            ->emptyStateHeading('No surfaces registered yet')
            ->emptyStateDescription('Create a surface so Orbit can interact with on-screen fields and buttons.')
            ->recordActions([
                EditAction::make(),
                DeleteAction::make()
                    ->modalDescription('Orbit will no longer recognize or operate this surface.')
                    ->before(function (OrbitSurface $record) {
                        AdminActivity::record('orbit_surface.deleted', $record, ['id' => $record->id]);
                        SurfaceCatalog::flushCache();
                    }),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListOrbitSurfaces::route('/'),
            'create' => CreateOrbitSurface::route('/create'),
            'edit' => EditOrbitSurface::route('/{record}/edit'),
        ];
    }
}
