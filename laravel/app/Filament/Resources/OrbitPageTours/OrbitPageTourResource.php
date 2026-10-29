<?php

namespace App\Filament\Resources\OrbitPageTours;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\OrbitPageTours\Pages\CreateOrbitPageTour;
use App\Filament\Resources\OrbitPageTours\Pages\EditOrbitPageTour;
use App\Filament\Resources\OrbitPageTours\Pages\ListOrbitPageTours;
use App\Models\OrbitPageTour;
use App\Services\Agent\PageTours;
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
use Filament\Schemas\Components\Utilities\Get;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Validation\ValidationException;
use UnitEnum;

/**
 * What Orbit says and shows when it explains a portal page: the overview (portal tour, short explanation) and the
 * detailed walkthrough (point at fields and buttons, open and close windows). Live as soon as it is saved. Steps
 * are checked against the portal catalog, and a tour can never press a button that changes data.
 */
class OrbitPageTourResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = OrbitPageTour::class;

    protected static string $permissionArea = 'orbit_knowledge';

    protected static ?string $modelLabel = 'page tour';

    protected static ?string $pluralModelLabel = 'Page tours';

    protected static ?string $slug = 'orbit-page-tours';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedMap;

    protected static string|UnitEnum|null $navigationGroup = 'Orbit';

    protected static ?string $navigationLabel = 'Page tours';

    protected static ?int $navigationSort = 4;

    protected static bool $shouldRegisterNavigation = false;

    protected static ?string $recordTitleAttribute = 'title';

    public const STEP_LABELS = [
        'point' => 'Point at a part, field or button',
        'open' => 'Open a form or panel',
        'press' => 'Press a button that only opens something',
        'close_popup' => 'Close the open window',
        'say' => 'Only say something',
    ];

    protected static function actionPermissions(): array
    {
        $manage = 'orbit_knowledge.manage';
        return ['create' => $manage, 'update' => $manage, 'delete' => $manage, 'reorder' => $manage];
    }

    /** Portal pages from the catalog, route => "Title (route)". */
    private static function pageOptions(): array
    {
        return collect(SurfaceCatalog::data()['pages'])->mapWithKeys(fn ($p) => [$p['route'] => "{$p['title']} ({$p['route']})"])->all();
    }

    /** Parts of the chosen page. */
    private static function surfaceOptions(?string $route): array
    {
        return collect(SurfaceCatalog::data()['surfaces'])->where('route', $route)->mapWithKeys(fn ($s) => [$s['id'] => $s['title']])->all();
    }

    private static function fieldOptions(?string $surfaceId): array
    {
        $surface = $surfaceId ? SurfaceCatalog::surface($surfaceId) : null;
        return collect($surface['fields'] ?? [])->mapWithKeys(fn ($f) => [$f['name'] => $f['label'] ?? $f['name']])->all();
    }

    /** Buttons of a part; for "press" only the ones that change nothing. */
    private static function actionOptions(?string $surfaceId, ?string $do): array
    {
        $surface = $surfaceId ? SurfaceCatalog::surface($surfaceId) : null;
        return collect($surface['actions'] ?? [])
            ->reject(fn ($a) => $do === 'press' && (!empty($a['consequential']) || !empty($a['destructive'])))
            ->mapWithKeys(fn ($a) => [$a['id'] => ($a['label'] ?? $a['id']) . (!empty($a['row']) ? ' (first row in the list)' : '')])
            ->all();
    }

    /** Refuse to save steps the server would drop, naming each one. */
    public static function assertStepsRun(array $data): void
    {
        $problems = PageTours::problems((string) ($data['route'] ?? ''), array_values((array) ($data['steps'] ?? [])));
        if ($problems !== []) {
            throw ValidationException::withMessages(['data.steps' => implode(' ', $problems)]);
        }
    }

    public static function form(Schema $schema): Schema
    {
        $usesSurface = fn (Get $get) => in_array($get('do'), ['point', 'open', 'press'], true);

        return $schema
            ->columns(1)
            ->components([
                Section::make('Page')
                    ->columns(3)
                    ->components([
                        Select::make('route')
                            ->label('Portal page')
                            ->options(fn () => self::pageOptions())
                            ->required()
                            ->native(false)
                            ->searchable()
                            ->live()
                            ->unique(ignoreRecord: true)
                            ->validationMessages(['unique' => 'This page already has a tour; edit that one.'])
                            ->columnSpan(2),
                        TextInput::make('title')->required()->maxLength(120),
                        Toggle::make('is_active')->label('Orbit uses this tour')->default(true)->inline(false),
                        TextInput::make('sort')
                            ->label('Order in the portal tour')
                            ->numeric()
                            ->integer()
                            ->minValue(0)
                            ->maxValue(65535)
                            ->default(fn () => (int) OrbitPageTour::max('sort') + 10)
                            ->required(),
                    ]),
                Section::make('Overview')
                    ->description('Spoken on this page in the portal tour, and when someone asks what the page is for. Two or three calm, plain sentences.')
                    ->components([
                        Textarea::make('overview')->hiddenLabel()->required()->rows(3)->maxLength(400),
                    ]),
                Section::make('Detailed walkthrough')
                    ->description('Used when the user says yes to "Do you want me to walk you through this page in detail?". Orbit runs the steps in order in the browser. Say what a button does before pressing it, and close every window you open. Buttons that change data can be pointed at, never pressed.')
                    ->components([
                        Repeater::make('steps')
                            ->hiddenLabel()
                            ->components([
                                Select::make('do')
                                    ->label('Orbit')
                                    ->options(self::STEP_LABELS)
                                    ->required()
                                    ->native(false)
                                    ->live(),
                                Select::make('surface')
                                    ->label('Part of the page')
                                    ->options(fn (Get $get) => self::surfaceOptions($get('../../route')))
                                    ->visible($usesSurface)
                                    ->required($usesSurface)
                                    ->native(false)
                                    ->live(),
                                Select::make('field')
                                    ->label('Field (optional)')
                                    ->options(fn (Get $get) => self::fieldOptions($get('surface')))
                                    ->visible(fn (Get $get) => $get('do') === 'point' && filled($get('surface')) && blank($get('action')))
                                    ->native(false)
                                    ->live(),
                                Select::make('action')
                                    ->label(fn (Get $get) => $get('do') === 'press' ? 'Button' : 'Button (optional)')
                                    ->options(fn (Get $get) => self::actionOptions($get('surface'), $get('do')))
                                    ->visible(fn (Get $get) => in_array($get('do'), ['point', 'press'], true) && filled($get('surface')) && blank($get('field')))
                                    ->required(fn (Get $get) => $get('do') === 'press')
                                    ->native(false)
                                    ->live(),
                                Textarea::make('say')
                                    ->label('Orbit says')
                                    ->rows(2)
                                    ->maxLength(400)
                                    ->required(fn (Get $get) => $get('do') === 'say')
                                    ->columnSpanFull(),
                            ])
                            ->columns(3)
                            ->itemLabel(fn (array $state) => (self::STEP_LABELS[$state['do'] ?? ''] ?? 'Step') . (filled($state['say'] ?? null) ? ': ' . str($state['say'])->limit(70) : ''))
                            ->collapsible()
                            ->reorderable()
                            ->cloneable()
                            ->maxItems(40)
                            ->defaultItems(0)
                            ->addActionLabel('Add step'),
                    ]),
            ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with('editor'))
            ->defaultSort('sort')
            ->reorderable('sort', self::adminCan('orbit_knowledge.manage'))
            ->columns([
                TextColumn::make('title')
                    ->description(fn (OrbitPageTour $record) => $record->route)
                    ->searchable(['title', 'route'])
                    ->weight('medium'),
                TextColumn::make('overview')->limit(90)->wrap()->toggleable(),
                TextColumn::make('steps_count')
                    ->label('Steps')
                    ->state(fn (OrbitPageTour $record) => count((array) $record->steps))
                    ->alignCenter(),
                TextColumn::make('problems')
                    ->label('Check')
                    ->badge()
                    ->state(fn (OrbitPageTour $record) => count(PageTours::problems($record->route, (array) $record->steps)) ?: 'OK')
                    ->formatStateUsing(fn ($state) => $state === 'OK' ? 'All steps run' : "{$state} skipped")
                    ->color(fn ($state) => $state === 'OK' ? 'success' : 'warning')
                    ->tooltip(fn (OrbitPageTour $record) => implode("\n", PageTours::problems($record->route, (array) $record->steps)) ?: null),
                IconColumn::make('is_active')->label('Used')->boolean()->alignCenter(),
                TextColumn::make('updated_at')
                    ->label('Edited')
                    ->since()
                    ->description(fn (OrbitPageTour $record) => $record->editor?->name)
                    ->sortable(),
            ])
            ->emptyStateIcon(Heroicon::OutlinedMap)
            ->emptyStateHeading('No page tours yet')
            ->emptyStateDescription('Add a tour for a portal page so Orbit can explain it and walk users through it.')
            ->recordActions([
                EditAction::make(),
                DeleteAction::make()
                    ->modalDescription('Orbit stops explaining this page in tours.')
                    ->before(fn (OrbitPageTour $record) => AdminActivity::record('orbit_page_tour.deleted', $record, ['route' => $record->route])),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListOrbitPageTours::route('/'),
            'create' => CreateOrbitPageTour::route('/create'),
            'edit' => EditOrbitPageTour::route('/{record}/edit'),
        ];
    }
}
