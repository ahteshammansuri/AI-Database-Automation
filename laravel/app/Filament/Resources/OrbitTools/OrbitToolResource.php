<?php

namespace App\Filament\Resources\OrbitTools;

use App\Admin\AdminActivity;
use App\Filament\Concerns\AuthorizesWithPermissions;
use App\Filament\Resources\OrbitTools\Pages\EditOrbitTool;
use App\Filament\Resources\OrbitTools\Pages\ListOrbitTools;
use App\Models\OrbitTool;
use App\Services\Agent\AgentToolRegistry;
use BackedEnum;
use Filament\Actions\EditAction;
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
 * Manage all Orbit agent capabilities, risk classifications, confirmation rules,
 * and parameter specifications dynamically from the Filament Admin Panel.
 */
class OrbitToolResource extends Resource
{
    use AuthorizesWithPermissions;

    protected static ?string $model = OrbitTool::class;

    protected static string $permissionArea = 'orbit_knowledge';

    protected static ?string $modelLabel = 'agent tool';

    protected static ?string $pluralModelLabel = 'Agent tools';

    protected static ?string $slug = 'orbit-tools';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedWrenchScrewdriver;

    protected static string|UnitEnum|null $navigationGroup = 'Orbit';

    protected static ?string $navigationLabel = 'Agent tools';

    protected static ?int $navigationSort = 7;

    protected static ?string $recordTitleAttribute = 'label';

    protected static function actionPermissions(): array
    {
        $manage = 'orbit_knowledge.manage';
        return ['create' => $manage, 'update' => $manage, 'delete' => $manage];
    }

    public static function form(Schema $schema): Schema
    {
        return $schema
            ->columns(1)
            ->components([
                Section::make('Tool Identity & Governance')
                    ->columns(3)
                    ->components([
                        TextInput::make('name')
                            ->label('Technical Tool Name')
                            ->required()
                            ->maxLength(120)
                            ->unique(ignoreRecord: true)
                            ->disabled(fn (?OrbitTool $record) => $record !== null)
                            ->helperText('Unique tool identifier, e.g. update_account_profile, test_database_connection'),
                        TextInput::make('label')
                            ->label('Display Name')
                            ->required()
                            ->maxLength(160),
                        Select::make('category')
                            ->label('Category')
                            ->options([
                                'ui' => 'UI Screen Operation',
                                'database' => 'Database Connection & Schema',
                                'automation' => 'Automation & Runs',
                                'approval' => 'Human Approval & Review',
                                'account' => 'Account & Profile',
                                'audit' => 'Audit & Security',
                                'data_operations' => 'Direct Data Operations',
                                'ai_provider' => 'AI Providers',
                                'knowledge' => 'Knowledge Base',
                                'general' => 'General',
                            ])
                            ->default('general')
                            ->native(false)
                            ->required(),
                        Select::make('risk_level')
                            ->label('Risk Level')
                            ->options([
                                'LOW' => 'LOW (Safe / Read-only)',
                                'MEDIUM' => 'MEDIUM (Scoped mutation)',
                                'HIGH' => 'HIGH (Consequential change)',
                                'CRITICAL' => 'CRITICAL (Destructive / Guarded)',
                            ])
                            ->default('LOW')
                            ->native(false)
                            ->required(),
                        Toggle::make('requires_confirmation')
                            ->label('Always Require User Confirmation')
                            ->helperText('Orbit will pause and ask the user before calling this tool.')
                            ->default(false),
                        Toggle::make('is_active')
                            ->label('Tool Enabled in Orbit')
                            ->helperText('Disable to immediately deactivate this capability across all users.')
                            ->default(true),
                        Toggle::make('read_only')
                            ->label('Read-only Tool')
                            ->default(false),
                        Toggle::make('idempotent')
                            ->label('Safe to Retry (Idempotent)')
                            ->default(true),
                        Toggle::make('audit_required')
                            ->label('Record in Audit Log')
                            ->default(false),
                        TextInput::make('sort')
                            ->label('Sort Order')
                            ->numeric()
                            ->default(10),
                    ]),

                Section::make('Model Instructions & Side Effects')
                    ->components([
                        Textarea::make('description')
                            ->label('Model Prompt / Description')
                            ->helperText('Instructions given to the AI model about when, why, and how to use this tool.')
                            ->rows(3)
                            ->required(),
                        Textarea::make('outcome')
                            ->label('Expected Outcome')
                            ->rows(2),
                        Textarea::make('side_effects')
                            ->label('Side Effects')
                            ->rows(2),
                    ]),

                Section::make('Agent-loop policy')
                    ->description('How the server runs this tool. Enforced by the server whatever the model decides.')
                    ->columns(2)
                    ->components([
                        Select::make('side_effect_class')
                            ->label('What a call does')
                            ->options([
                                'read' => 'Reads only',
                                'platform_metadata' => 'Changes platform data only (previews, scans)',
                                'write' => 'Changes the workspace',
                                'external' => 'Changes the customer\'s database or publishes',
                                'ui' => 'Operates the screen',
                            ])
                            ->native(false)
                            ->helperText('Empty: read for read-only tools, otherwise a change to the workspace.'),
                        Select::make('postcondition')
                            ->label('Check after success')
                            ->options([
                                'connection_persisted' => 'The connection is saved',
                                'schema_snapshot_exists' => 'A schema snapshot exists',
                                'automation_persisted' => 'The automation is saved',
                                'version_approved' => 'The draft is approved',
                            ])
                            ->native(false),
                        Toggle::make('always_confirm')
                            ->label('Always ask the user first')
                            ->helperText('Whatever the user\'s autonomy setting.'),
                        Toggle::make('confirm_by_button')
                            ->label('Only the Confirm button confirms')
                            ->helperText('For destructive steps: a typed or spoken "yes" is not enough.'),
                        Textarea::make('secret_params')
                            ->label('Arguments filled from the secure field')
                            ->helperText('JSON, argument => secret kind, e.g. {"password": "database_password"}. Arguments named like a password, key or token are always filled from the secure field, never by the model.')
                            ->rows(2)
                            ->columnSpanFull()
                            ->formatStateUsing(fn ($state) => is_array($state) ? json_encode((object) $state, JSON_UNESCAPED_SLASHES) : $state)
                            ->dehydrateStateUsing(fn ($state) => is_string($state) ? (json_decode($state, true) ?: []) : ($state ?? [])),
                    ]),

                Section::make('JSON Parameter & Output Schemas')
                    ->collapsed()
                    ->components([
                        Textarea::make('parameters')
                            ->label('Parameters JSON Schema')
                            ->rows(7)
                            ->formatStateUsing(fn ($state) => is_array($state) ? json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) : $state)
                            ->dehydrateStateUsing(fn ($state) => is_string($state) ? (json_decode($state, true) ?: ['type' => 'object']) : $state),
                        Textarea::make('output_schema')
                            ->label('Output JSON Schema')
                            ->rows(4)
                            ->formatStateUsing(fn ($state) => is_array($state) ? json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) : $state)
                            ->dehydrateStateUsing(fn ($state) => is_string($state) ? (json_decode($state, true) ?: ['type' => 'object']) : $state),
                    ]),
            ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('sort')
            ->columns([
                TextColumn::make('name')
                    ->label('Tool Name')
                    ->searchable()
                    ->weight('bold'),
                TextColumn::make('label')
                    ->label('Label')
                    ->searchable(),
                TextColumn::make('category')
                    ->label('Category')
                    ->badge()
                    ->color(fn (string $state) => match ($state) {
                        'ui' => 'info',
                        'database' => 'primary',
                        'automation' => 'success',
                        'approval' => 'warning',
                        'account' => 'purple',
                        'audit' => 'gray',
                        default => 'slate',
                    })
                    ->searchable(),
                TextColumn::make('risk_level')
                    ->label('Risk')
                    ->badge()
                    ->color(fn (string $state) => match ($state) {
                        'LOW' => 'info',
                        'MEDIUM' => 'warning',
                        'HIGH', 'CRITICAL' => 'danger',
                        default => 'gray',
                    })
                    ->alignCenter(),
                IconColumn::make('requires_confirmation')
                    ->label('Confirm')
                    ->boolean()
                    ->alignCenter(),
                IconColumn::make('is_ui')
                    ->label('UI Screen')
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
                SelectFilter::make('category')
                    ->options([
                        'ui' => 'UI Screen Operation',
                        'database' => 'Database Connection & Schema',
                        'automation' => 'Automation & Runs',
                        'approval' => 'Human Approval & Review',
                        'account' => 'Account & Profile',
                        'audit' => 'Audit & Security',
                        'data_operations' => 'Direct Data Operations',
                        'ai_provider' => 'AI Providers',
                        'knowledge' => 'Knowledge Base',
                    ]),
                SelectFilter::make('risk_level')
                    ->options([
                        'LOW' => 'LOW',
                        'MEDIUM' => 'MEDIUM',
                        'HIGH' => 'HIGH',
                        'CRITICAL' => 'CRITICAL',
                    ]),
            ])
            ->emptyStateIcon(Heroicon::OutlinedWrenchScrewdriver)
            ->emptyStateHeading('No tools configured')
            ->recordActions([
                EditAction::make(),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListOrbitTools::route('/'),
            'edit' => EditOrbitTool::route('/{record}/edit'),
        ];
    }
}
