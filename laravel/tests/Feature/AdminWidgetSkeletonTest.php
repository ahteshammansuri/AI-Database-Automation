<?php

namespace Tests\Feature;

use App\Filament\Widgets\NewestCustomers;
use App\Filament\Widgets\PlatformStats;
use App\Filament\Widgets\RecentFailedRuns;
use App\Filament\Widgets\RunsChart;
use App\Filament\Widgets\SignupsChart;
use App\Models\Admin;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/**
 * Admin dashboard widgets load lazily; until they do, each shows a skeleton in its own shape instead of an empty
 * box, and building that placeholder never runs the widget's queries.
 */
class AdminWidgetSkeletonTest extends TestCase
{
    use RefreshDatabase;

    public function test_each_widget_placeholder_is_a_skeleton_of_its_kind_and_queries_nothing(): void
    {
        $cases = [
            PlatformStats::class => 'da-adm-stats',
            SignupsChart::class => 'da-adm-line',
            RunsChart::class => 'da-adm-bars',
            NewestCustomers::class => 'da-adm-table',
            RecentFailedRuns::class => 'da-adm-table',
        ];

        foreach ($cases as $widget => $shape) {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $html = (new $widget())->placeholder()->render();
            $queries = DB::getQueryLog();
            DB::disableQueryLog();

            $this->assertSame([], $queries, "{$widget} queried the database for its placeholder");
            $this->assertStringContainsString('role="status"', $html, $widget);
            $this->assertStringContainsString('da-adm-skel', $html, $widget);
            $this->assertStringContainsString($shape, $html, $widget);
            $this->assertStringNotContainsString('fi-loading-section', $html, $widget);
        }
    }

    public function test_stats_placeholder_has_a_card_per_stat_in_the_widgets_columns(): void
    {
        $html = (new PlatformStats())->placeholder()->render();

        $this->assertStringContainsString('--da-cols: 4', $html);
        $this->assertSame(8, substr_count($html, 'fi-wi-stats-overview-stat da-adm-stat'));
    }

    public function test_chart_placeholders_keep_their_real_heading(): void
    {
        $html = (new RunsChart())->placeholder()->render();

        $this->assertStringContainsString('Automation runs', $html);
        $this->assertStringContainsString('Published, failed and missed per day, last 14 days', $html);
        $this->assertStringContainsString('height: 260px', $html);
    }

    public function test_the_dashboard_opens_with_skeletons_in_place_of_its_widgets(): void
    {
        $this->artisan('admin:sync-permissions')->assertSuccessful();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $admin = Admin::create([
            'name' => 'Ada Admin',
            'email' => 'admin@example.test',
            'password' => 'correct-horse-battery-9',
            'is_active' => true,
        ]);
        $admin->assignRole(Admin::SUPER_ADMIN);

        $html = $this->actingAs($admin, 'admin')->get('/admin')->assertOk()->getContent();

        $this->assertStringContainsString('da-adm-stats', $html);
        $this->assertStringContainsString('da-adm-bars', $html);
        $this->assertStringContainsString('da-adm-line', $html);
        $this->assertSame(2, substr_count($html, 'fi-ta-ctn da-adm-table'));
    }
}
