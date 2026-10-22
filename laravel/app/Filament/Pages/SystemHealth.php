<?php

namespace App\Filament\Pages;

use App\Admin\AdminActivity;
use App\Admin\SystemHealth as Health;
use App\Filament\Resources\FailedJobs\FailedJobResource;
use App\Models\Admin;
use App\Settings\PlatformSettings;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Facades\Filament;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\RepeatableEntry\TableColumn;
use Filament\Infolists\Components\TextEntry;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Grid;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Text;
use Filament\Schemas\Schema;
use Filament\Support\Enums\FontFamily;
use Filament\Support\Icons\Heroicon;
use UnitEnum;

/** Live status of everything the platform depends on, plus the server settings that stay in the environment. */
class SystemHealth extends Page
{
    protected static ?string $slug = 'system-health';

    protected static ?string $title = 'System health';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedHeart;

    protected static string|UnitEnum|null $navigationGroup = 'System';

    protected static ?string $navigationLabel = 'Health';

    protected static ?int $navigationSort = 1;

    protected string $view = 'filament-panels::pages.page';

    /** Checked once per request (each refresh checks again). */
    private ?array $checks = null;

    public static function canAccess(): bool
    {
        return self::allowed('system.view');
    }

    private static function allowed(string $permission): bool
    {
        $admin = Filament::auth()->user();
        return $admin instanceof Admin && $admin->can($permission);
    }

    public function getSubheading(): ?string
    {
        return 'Checked when the page opens. Check again for fresh results.';
    }

    protected function checks(): array
    {
        return $this->checks ??= [
            'services' => [
                ['Platform database', 'heroicon-o-circle-stack', Health::database()],
                ['AI service', 'heroicon-o-cpu-chip', Health::aiService()],
                ['Local models (Ollama)', 'heroicon-o-sparkles', Health::ollama()],
                ['Real-time server', 'heroicon-o-signal', Health::reverb()],
                ['Scheduler', 'heroicon-o-clock', Health::scheduler()],
                ['Email', 'heroicon-o-envelope', Health::mail()],
                ['Storage', 'heroicon-o-server', Health::storage()],
                ['Failed jobs', 'heroicon-o-exclamation-triangle', Health::failedJobs()],
            ],
            'queues' => Health::queues(),
        ];
    }

    private static function color(string $status): string
    {
        return ['ok' => 'success', 'warn' => 'warning', 'down' => 'danger'][$status] ?? 'gray';
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('refresh')
                ->label('Check again')
                ->icon('heroicon-o-arrow-path')
                ->action(fn () => $this->checks = null),
            Action::make('reloadSettings')
                ->label('Reload settings')
                ->icon('heroicon-o-adjustments-horizontal')
                ->color('gray')
                ->visible(fn () => self::allowed('system.manage'))
                ->requiresConfirmation()
                ->modalDescription('Every saved setting is read again from the database. Queue workers pick it up before their next job. Use this if settings were changed outside the panel.')
                ->action(function () {
                    PlatformSettings::reload();
                    AdminActivity::record('system.settings_reloaded', 'Settings');
                    Notification::make()->title('Settings reloaded')->success()->send();
                }),
        ];
    }

    public function content(Schema $schema): Schema
    {
        $checks = $this->checks();

        $services = [];
        foreach ($checks['services'] as [$name, $icon, $check]) {
            $card = Section::make($name)
                ->icon($icon)
                ->iconColor(self::color($check['status']))
                ->description($check['detail'])
                ->afterHeader([Text::make($check['summary'])->badge()->color(self::color($check['status']))])
                ->compact();
            if ($check['latency_ms'] !== null) {
                $card->schema([Text::make("Answered in {$check['latency_ms']} ms")->color('gray')]);
            }
            if ($name === 'Failed jobs' && FailedJobResource::canViewAny()) {
                $card->footerActions([Action::make('openFailed')->label('Open failed jobs')->link()->url(FailedJobResource::getUrl())]);
            }
            $services[] = $card;
        }

        $queues = [];
        foreach ($checks['queues'] as $queue => $q) {
            $queues[] = Section::make(ucfirst($queue) . ' queue')
                ->description($q['label'])
                ->icon('heroicon-o-queue-list')
                ->iconColor(self::color($q['status']))
                ->afterHeader([Text::make($q['summary'])->badge()->color(self::color($q['status']))])
                ->compact()
                ->columns(4)
                ->schema([
                    TextEntry::make("q_{$queue}_worker")->label('Worker')->state($q['worker']),
                    TextEntry::make("q_{$queue}_waiting")->label('Waiting')->state($q['waiting']),
                    TextEntry::make("q_{$queue}_running")->label('Running')->state($q['running']),
                    TextEntry::make("q_{$queue}_oldest")->label('Oldest waiting')->state($q['oldest']),
                    Text::make($q['command'])->fontFamily(FontFamily::Mono)->color('gray')->columnSpanFull(),
                ]);
        }

        return $schema->components([
            Section::make('Services')
                ->description('Everything the platform needs to run.')
                ->schema([Grid::make(['default' => 1, 'md' => 2, 'xl' => 4])->schema($services)]),
            Section::make('Background workers')
                ->description('Jobs wait in a queue until a worker runs them. Without a worker, automations and Orbit stop.')
                ->schema([Grid::make(['default' => 1, 'lg' => 2])->schema($queues)]),
            Section::make('Server environment')
                ->description("Read-only. These stay in the server's .env file for the reason shown; change them there and restart the services. Everything else is in Settings.")
                ->collapsible()
                ->schema([
                    RepeatableEntry::make('environment')
                        ->hiddenLabel()
                        ->state(Health::environment())
                        ->table([
                            TableColumn::make('Name'),
                            TableColumn::make('Value'),
                            TableColumn::make('Why it stays on the server'),
                        ])
                        ->schema([
                            TextEntry::make('name')->fontFamily(FontFamily::Mono)->size('sm'),
                            TextEntry::make('value')
                                ->color(fn ($state, $record) => ($record['warn'] ?? false) ? 'warning' : null)
                                ->icon(fn ($state, $record) => ($record['warn'] ?? false) ? 'heroicon-m-exclamation-triangle' : null),
                            TextEntry::make('why')->color('gray'),
                        ]),
                ]),
        ]);
    }
}
