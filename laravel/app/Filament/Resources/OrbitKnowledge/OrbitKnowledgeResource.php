<?php

namespace App\Filament\Resources\OrbitKnowledge;

use App\Admin\AdminActivity;
use App\Admin\OrbitKnowledge;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\OrbitKnowledge\Pages\CreateOrbitKnowledge;
use App\Filament\Resources\OrbitKnowledge\Pages\EditOrbitKnowledge;
use App\Filament\Resources\OrbitKnowledge\Pages\ListOrbitKnowledge;
use App\Models\OrbitKnowledgeGuide;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\DeleteAction;
use Filament\Actions\EditAction;
use Filament\Forms\Components\MarkdownEditor;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Utilities\Get;
use Filament\Schemas\Components\Utilities\Set;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use RuntimeException;
use UnitEnum;

/**
 * What Orbit knows about the website. Edits are drafts until "Publish to Orbit" sends the included guides to the
 * AI service, which re-indexes them. Guides are knowledge only: what Orbit may do is decided by the gate, never here.
 */
class OrbitKnowledgeResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = OrbitKnowledgeGuide::class;

    protected static string $permissionArea = 'orbit_knowledge';

    protected static ?string $modelLabel = 'guide';

    protected static ?string $pluralModelLabel = 'Orbit knowledge';

    protected static ?string $slug = 'orbit-knowledge';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedBookOpen;

    protected static string|UnitEnum|null $navigationGroup = 'Orbit';

    protected static ?string $navigationLabel = 'Knowledge';

    protected static ?int $navigationSort = 3;

    protected static ?string $recordTitleAttribute = 'title';

    public const STATES = [
        'live' => ['Live', 'success'],
        'pending' => ['Not live yet', 'warning'],
        'removing' => ['Removal not live yet', 'warning'],
        'hidden' => ['Not included', 'gray'],
    ];

    protected static function actionPermissions(): array
    {
        $manage = 'orbit_knowledge.manage';
        return ['create' => $manage, 'update' => $manage, 'delete' => $manage, 'reorder' => $manage];
    }

    public static function unpublishedCount(): int
    {
        return OrbitKnowledgeGuide::all()->filter(fn (OrbitKnowledgeGuide $g) => in_array($g->liveState(), ['pending', 'removing'], true))->count();
    }

    public static function getNavigationBadge(): ?string
    {
        return self::unpublishedCount() ?: null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
    }

    public static function getNavigationBadgeTooltip(): ?string
    {
        return 'Guide changes not live in Orbit yet';
    }

    public static function sections(?string $body): int
    {
        return preg_match_all('/^##\s+\S/m', (string) $body);
    }

    public static function form(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Guide')
                    ->description('Orbit cites a guide by its name when it answers from it.')
                    ->columns(3)
                    ->components([
                        TextInput::make('title')
                            ->required()
                            ->maxLength(120)
                            ->live(onBlur: true)
                            ->afterStateUpdated(function (?string $state, Get $get, Set $set, string $operation) {
                                if ($operation === 'create' && blank($get('slug'))) {
                                    $set('slug', str((string) $state)->slug('_')->limit(80, '')->toString());
                                }
                            })
                            ->columnSpan(2),
                        TextInput::make('slug')
                            ->label('Name')
                            ->required()
                            ->maxLength(81)
                            ->regex(OrbitKnowledgeGuide::SLUG_PATTERN)
                            ->unique(ignoreRecord: true)
                            ->validationMessages([
                                'regex' => 'Use lowercase letters, numbers, - and _ only, starting with a letter or number.',
                                'unique' => 'Another guide already has this name.',
                            ])
                            ->helperText('Lowercase letters, numbers, - and _')
                            ->extraInputAttributes(['class' => 'font-mono']),
                        Toggle::make('is_published')
                            ->label("Include in Orbit's knowledge")
                            ->helperText('Applies when you publish to Orbit.')
                            ->default(true)
                            ->inline(false),
                        TextInput::make('sort')
                            ->label('Order')
                            ->numeric()
                            ->integer()
                            ->minValue(0)
                            ->maxValue(65535)
                            ->default(fn () => (int) OrbitKnowledgeGuide::max('sort') + 10)
                            ->required(),
                    ]),
                Section::make('Content')
                    ->description('Markdown. Each "## " section becomes one piece Orbit can retrieve, so give every section a clear heading and keep it about one topic. Write facts about the website; rules here cannot grant Orbit permissions.')
                    ->components([
                        MarkdownEditor::make('body')
                            ->hiddenLabel()
                            ->required()
                            ->maxLength(60000)
                            ->fileAttachments(false)
                            ->toolbarButtons([
                                ['bold', 'italic', 'link'],
                                ['heading'],
                                ['blockquote', 'codeBlock', 'bulletList', 'orderedList'],
                                ['table'],
                                ['undo', 'redo'],
                            ])
                            ->minHeight('28rem')
                            ->validationMessages(['required' => 'Write what Orbit should know.']),
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
                    ->description(fn (OrbitKnowledgeGuide $record) => $record->slug)
                    ->searchable(['title', 'slug'])
                    ->weight('medium')
                    ->wrap(),
                TextColumn::make('state')
                    ->label("In Orbit")
                    ->badge()
                    ->state(fn (OrbitKnowledgeGuide $record) => $record->liveState())
                    ->formatStateUsing(fn ($state) => self::STATES[$state][0] ?? $state)
                    ->color(fn ($state) => self::STATES[$state][1] ?? 'gray'),
                TextColumn::make('sections')
                    ->label('Sections')
                    ->state(fn (OrbitKnowledgeGuide $record) => self::sections($record->body))
                    ->alignCenter(),
                TextColumn::make('words')
                    ->label('Words')
                    ->state(fn (OrbitKnowledgeGuide $record) => str_word_count(strip_tags((string) $record->body)))
                    ->numeric()
                    ->alignCenter()
                    ->toggleable(isToggledHiddenByDefault: true),
                IconColumn::make('is_published')->label('Included')->boolean()->alignCenter(),
                TextColumn::make('updated_at')
                    ->label('Edited')
                    ->since()
                    ->description(fn (OrbitKnowledgeGuide $record) => $record->editor?->name)
                    ->sortable(),
                TextColumn::make('published_at')->label('Published')->since()->placeholder('—')->toggleable(isToggledHiddenByDefault: true),
            ])
            ->emptyStateIcon(Heroicon::OutlinedBookOpen)
            ->emptyStateHeading('Orbit is using the built-in guides')
            ->emptyStateDescription('Load them here to edit what Orbit knows about the website, or write your own guide.')
            ->emptyStateActions([self::restoreAction('Load built-in guides')])
            ->recordActions([
                EditAction::make(),
                DeleteAction::make()
                    ->modalDescription('Orbit keeps this guide until you publish again.')
                    ->before(fn (OrbitKnowledgeGuide $record) => AdminActivity::record('orbit_knowledge.deleted', $record)),
            ]);
    }

    /** Send every included guide to Orbit (the AI service re-indexes them right away). */
    public static function publishAction(): Action
    {
        return Action::make('publish')
            ->label('Publish to Orbit')
            ->icon('heroicon-o-rocket-launch')
            ->visible(fn () => self::adminCan('orbit_knowledge.manage') && OrbitKnowledgeGuide::exists())
            ->requiresConfirmation()
            ->modalIcon('heroicon-o-rocket-launch')
            ->modalHeading('Publish to Orbit?')
            ->modalDescription(function () {
                $included = OrbitKnowledgeGuide::where('is_published', true)->count();
                return "Orbit's knowledge of the website is replaced by the {$included} included " . str('guide')->plural($included)
                    . ' and re-indexed. Guides that are not included are removed from Orbit. This can take up to a minute.';
            })
            ->modalSubmitActionLabel('Publish')
            ->action(function ($livewire) {
                try {
                    $res = OrbitKnowledge::publish();
                } catch (RuntimeException $e) {
                    Notification::make()->title('Not published')->body($e->getMessage())->danger()->persistent()->send();
                    return;
                }
                $backend = str_starts_with((string) $res['embedding_backend'], 'ollama')
                    ? 'semantic search (' . substr((string) $res['embedding_backend'], 7) . ')'
                    : 'keyword search, because the embedding model is not reachable';
                Notification::make()
                    ->title('Orbit is using the new guides')
                    ->body("{$res['guides']} " . str('guide')->plural($res['guides']) . ", {$res['chunks']} sections, indexed for {$backend}.")
                    ->success()
                    ->send();
                $livewire->dispatch('orbit-knowledge-changed');
            });
    }

    public static function restoreAction(string $label = 'Restore built-in guides'): Action
    {
        return Action::make('restoreBundled')
            ->label($label)
            ->icon('heroicon-o-arrow-path')
            ->color('gray')
            ->visible(fn () => self::adminCan('orbit_knowledge.manage') && OrbitKnowledge::bundled() !== [])
            ->requiresConfirmation()
            ->modalHeading($label . '?')
            ->modalDescription(fn () => OrbitKnowledgeGuide::exists()
                ? 'The ' . count(OrbitKnowledge::bundled()) . ' guides that ship with the app get their original text back. Your own guides are kept. Orbit uses the change after you publish.'
                : 'The ' . count(OrbitKnowledge::bundled()) . ' guides that ship with the app are added here, exactly as Orbit uses them now.')
            ->action(function ($livewire) {
                $n = OrbitKnowledge::restoreBundled();
                Notification::make()->title("{$n} built-in " . str('guide')->plural($n) . ' loaded')->body('Publish to Orbit to make edits live.')->success()->send();
                $livewire->dispatch('orbit-knowledge-changed');
            });
    }

    public static function getPages(): array
    {
        return [
            'index' => ListOrbitKnowledge::route('/'),
            'create' => CreateOrbitKnowledge::route('/create'),
            'edit' => EditOrbitKnowledge::route('/{record}/edit'),
        ];
    }
}
