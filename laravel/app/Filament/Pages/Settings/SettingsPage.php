<?php

namespace App\Filament\Pages\Settings;

use App\Models\Admin;
use App\Settings\PlatformSettings;
use App\Settings\SettingsRegistry;
use Filament\Actions\Action;
use Filament\Facades\Filament;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Actions;
use Filament\Schemas\Components\EmbeddedSchema;
use Filament\Schemas\Components\Form;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\Alignment;
use Illuminate\Contracts\Support\Htmlable;
use Illuminate\Validation\ValidationException;
use UnitEnum;

/**
 * One page of admin settings, built from SettingsRegistry (fields, limits, help and defaults live there). Saving
 * goes through PlatformSettings::save(), which validates on the server and records the change.
 */
abstract class SettingsPage extends Page
{
    protected static string $settingsGroup;

    protected static string $viewPermission = 'settings.view';

    protected static string $managePermission = 'settings.manage';

    protected static string|UnitEnum|null $navigationGroup = 'Settings';

    public ?array $data = [];

    public static function canAccess(): bool
    {
        $admin = Filament::auth()->user();
        return $admin instanceof Admin && $admin->can(static::$viewPermission);
    }

    public static function canManage(): bool
    {
        $admin = Filament::auth()->user();
        return $admin instanceof Admin && $admin->can(static::$managePermission);
    }

    public static function getNavigationLabel(): string
    {
        return SettingsRegistry::GROUPS[static::$settingsGroup][0];
    }

    public static function getNavigationIcon(): string
    {
        return 'heroicon-' . SettingsRegistry::GROUPS[static::$settingsGroup][2];
    }

    public function getTitle(): string|Htmlable
    {
        return static::getNavigationLabel();
    }

    public function getSubheading(): string|Htmlable|null
    {
        return SettingsRegistry::GROUPS[static::$settingsGroup][1];
    }

    public function mount(): void
    {
        $state = [];
        foreach (PlatformSettings::groupValues(static::$settingsGroup) as $key => $value) {
            $state[self::field($key)] = $value;
        }
        $this->form->fill($state);
    }

    public function form(Schema $schema): Schema
    {
        $sections = [];
        foreach (SettingsRegistry::group(static::$settingsGroup) as $key => $def) {
            $sections[$def['section']][] = $this->fieldFor($key, $def);
        }

        $components = [];
        foreach ($sections as $title => $fields) {
            $components[] = Section::make($title)->columns(2)->components($fields);
        }

        return $schema
            ->components($components)
            ->statePath('data')
            ->disabled(!static::canManage());
    }

    public function content(Schema $schema): Schema
    {
        return $schema->components([
            Form::make([EmbeddedSchema::make('form')])
                ->id('form')
                ->livewireSubmitHandler('save')
                ->footer([
                    Actions::make([
                        Action::make('save')
                            ->label('Save changes')
                            ->submit('save')
                            ->keyBindings(['mod+s'])
                            ->visible(static::canManage()),
                    ])->alignment(Alignment::Start)->sticky(),
                ]),
        ]);
    }

    protected function getHeaderActions(): array
    {
        $keys = array_keys(SettingsRegistry::group(static::$settingsGroup));
        return [
            Action::make('restoreDefaults')
                ->label('Restore defaults')
                ->icon('heroicon-o-arrow-uturn-left')
                ->color('gray')
                ->requiresConfirmation()
                ->modalHeading('Restore the defaults on this page?')
                ->modalDescription('Every setting on this page goes back to its default. This applies right away.')
                ->visible(static::canManage() && collect($keys)->contains(fn ($k) => PlatformSettings::isOverridden($k)))
                ->action(function () use ($keys) {
                    PlatformSettings::reset($keys, static::$settingsGroup === 'content' ? 'content.reset' : 'settings.reset');
                    $this->mount();
                    Notification::make()->title('Defaults restored')->success()->send();
                }),
        ];
    }

    public function save(): void
    {
        abort_unless(static::canManage(), 403);
        $state = $this->form->getState();

        $values = [];
        foreach (SettingsRegistry::group(static::$settingsGroup) as $key => $def) {
            if (array_key_exists(self::field($key), $state)) {
                $values[$key] = $state[self::field($key)];
            }
        }

        try {
            $changes = PlatformSettings::save($values, static::$settingsGroup === 'content' ? 'content.updated' : 'settings.updated');
        } catch (ValidationException $e) {
            $errors = [];
            foreach ($e->errors() as $key => $messages) {
                $errors['data.' . self::field($key)] = $messages;
            }
            throw ValidationException::withMessages($errors);
        }

        $this->mount();
        Notification::make()
            ->title($changes ? 'Saved' : 'Nothing changed')
            ->body($changes ? 'The new settings apply right away.' : null)
            ->success()
            ->send();
    }

    // ------------------------------------------------------------------ fields

    protected function fieldFor(string $key, array $def): mixed
    {
        $name = self::field($key);
        $field = match ($def['type']) {
            'bool' => Toggle::make($name)->inline(false),
            'int' => TextInput::make($name)->numeric()->integer()->minValue($def['min'] ?? null)->maxValue($def['max'] ?? null)
                ->suffix($def['suffix'] ?? null)->required(),
            'email' => TextInput::make($name)->email()->maxLength(255)->required(!($def['nullable'] ?? false)),
            'url' => TextInput::make($name)->url()->maxLength(255)->required(!($def['nullable'] ?? false))->placeholder('https://'),
            'select' => Select::make($name)->options($def['options'])->native(false)->required(),
            'text' => Textarea::make($name)->rows(3)->maxLength($def['max'] ?? 2000)->columnSpanFull()
                ->required($def['group'] !== 'content' && !($def['nullable'] ?? false)),
            'list' => Repeater::make($name)
                ->components(collect($def['fields'])->map(fn ($f, $fieldName) => ($f['rows'] ?? null)
                    ? Textarea::make($fieldName)->label($f['label'])->rows($f['rows'])->maxLength($f['max'] ?? 1000)->required()
                    : TextInput::make($fieldName)->label($f['label'])->maxLength($f['max'] ?? 255)->required())->values()->all())
                ->itemLabel(fn (array $state) => $state[array_key_first($def['fields'])] ?? null)
                ->collapsible()
                ->collapsed()
                ->reorderable()
                ->maxItems($def['max_items'] ?? 50)
                ->addActionLabel('Add')
                ->columnSpanFull(),
            default => TextInput::make($name)->maxLength($def['max'] ?? 255)
                ->required($def['group'] !== 'content' && !($def['nullable'] ?? false)),
        };

        $default = PlatformSettings::default($key);
        $changed = PlatformSettings::isOverridden($key);
        $defaultText = match (true) {
            is_bool($default) => $default ? 'on' : 'off',
            is_array($default) => count($default) . ' items',
            $default === null || $default === '' => 'empty',
            default => (string) $default,
        };

        return $field
            ->label($def['label'])
            ->helperText($def['help'])
            ->hint($changed ? 'Changed · default ' . str($defaultText)->limit(40) : null)
            ->hintColor('primary');
    }

    /** Dots in setting keys would be read as nesting in the form state. */
    protected static function field(string $key): string
    {
        return str_replace('.', '__', $key);
    }
}
