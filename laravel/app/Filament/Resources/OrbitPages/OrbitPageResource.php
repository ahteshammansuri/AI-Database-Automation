<?php

namespace App\Filament\Resources\OrbitPages;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\OrbitPages\Pages\CreateOrbitPage;
use App\Filament\Resources\OrbitPages\Pages\EditOrbitPage;
use App\Filament\Resources\OrbitPages\Pages\ListOrbitPages;
use App\Models\OrbitPage;
use App\Services\Agent\SurfaceCatalog;
use BackedEnum;
use Filament\Actions\DeleteAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use UnitEnum;

/**
 * Manage portal routes and pages that Orbit recognizes and can navigate to.
 */
class OrbitPageResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = OrbitPage::class;

    protected static string $permissionArea = 'orbit_knowledge';

    protected static ?string $modelLabel = 'portal page';

    protected static ?string $pluralModelLabel = 'Portal pages';

    protected static ?string $slug = 'orbit-pages';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedDocumentText;

    protected static string|UnitEnum|null $navigationGroup = 'Orbit';

    protected static ?string $navigationLabel = 'Portal pages';

    protected static ?int $navigationSort = 6;

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
                Section::make('Page Route & Details')
                    ->columns(2)
                    ->components([
                        TextInput::make('route')
                            ->label('Route Path')
                            ->required()
                            ->maxLength(120)
                            ->unique(ignoreRecord: true)
                            ->helperText('e.g. /dashboard, /account, /connections'),
                        TextInput::make('title')
                            ->label('Page Title')
                            ->required()
                            ->maxLength(160),
                        Toggle::make('is_active')
                            ->label('Active in Orbit')
                            ->default(true),
                        TextInput::make('sort')
                            ->label('Sort Order')
                            ->numeric()
                            ->default(10),
                        Textarea::make('description')
                            ->label('Description & Purpose')
                            ->rows(3)
                            ->columnSpanFull(),
                    ]),
            ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('sort')
            ->columns([
                TextColumn::make('route')
                    ->label('Route')
                    ->badge()
                    ->color('info')
                    ->searchable()
                    ->weight('bold'),
                TextColumn::make('title')
                    ->label('Title')
                    ->searchable(),
                TextColumn::make('surfaces_count')
                    ->label('Surfaces')
                    ->counts('surfaces')
                    ->badge()
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
            ->emptyStateIcon(Heroicon::OutlinedDocumentText)
            ->emptyStateHeading('No portal pages registered')
            ->recordActions([
                EditAction::make(),
                DeleteAction::make()
                    ->modalDescription('Orbit will no longer navigate to this route.')
                    ->before(function (OrbitPage $record) {
                        AdminActivity::record('orbit_page.deleted', $record, ['route' => $record->route]);
                        SurfaceCatalog::flushCache();
                    }),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListOrbitPages::route('/'),
            'create' => CreateOrbitPage::route('/create'),
            'edit' => EditOrbitPage::route('/{record}/edit'),
        ];
    }
}
