<?php

namespace Tests\Feature;

use App\Filament\Resources\OrbitPageTours\Pages\EditOrbitPageTour;
use App\Models\Admin;
use App\Models\AdminActivityLog;
use App\Models\AgentTask;
use App\Models\OrbitPageTour;
use App\Models\User;
use App\Services\Agent\AgentOrchestrator;
use App\Services\Agent\PageTours;
use App\Services\Agent\SurfaceCatalog;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/**
 * Orbit's page tours: stored in the database, checked against the portal catalog, never pressing a button that
 * changes data, and editable by admins who may manage Orbit's knowledge.
 */
class OrbitPageToursTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role): Admin
    {
        $this->artisan('admin:sync-permissions')->assertSuccessful();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $admin = Admin::create(['name' => 'Ada', 'email' => 'tours' . Admin::count() . '@example.test', 'password' => 'correct-horse-battery-9', 'is_active' => true]);
        $admin->assignRole($role);

        return $admin;
    }

    public function test_steps_that_would_change_data_or_do_not_exist_are_dropped()
    {
        $steps = PageTours::validSteps([
            ['do' => 'press', 'surface' => 'approvals.list', 'action' => 'approve', 'say' => 'Approving.'],
            ['do' => 'press', 'surface' => 'connections.list', 'action' => 'remove', 'say' => 'Removing.'],
            ['do' => 'press', 'surface' => 'manual.form', 'action' => 'publish', 'say' => 'Publishing.'],
            ['do' => 'point', 'surface' => 'no.such.surface', 'say' => 'Nothing.'],
            ['do' => 'point', 'surface' => 'connections.form', 'field' => 'no_such_field', 'say' => 'Nothing.'],
            ['do' => 'delete_everything', 'say' => 'No.'],
            ['do' => 'press', 'surface' => 'approvals.list', 'say' => 'No button.'],
            ['do' => 'say', 'say' => ''],
            ['do' => 'press', 'surface' => 'approvals.list', 'action' => 'open', 'say' => 'Review opens the draft.'],
            ['do' => 'point', 'surface' => 'approvals.list', 'action' => 'approve', 'say' => 'Approve publishes it after you confirm.'],
            ['do' => 'close_popup', 'say' => ''],
        ]);

        $this->assertSame([
            ['do' => 'press', 'surface' => 'approvals.list', 'say' => 'Review opens the draft.', 'action' => 'open', 'row' => 'first'],
            ['do' => 'point', 'surface' => 'approvals.list', 'say' => 'Approve publishes it after you confirm.', 'action' => 'approve', 'row' => 'first'],
            ['do' => 'close_popup', 'say' => ''],
        ], $steps);
    }

    public function test_every_stored_tour_runs_completely_and_never_presses_a_data_changing_button()
    {
        $tours = OrbitPageTour::all();
        $this->assertGreaterThanOrEqual(10, $tours->count(), 'the portal pages come with tours');
        foreach ($tours as $tour) {
            $this->assertContains($tour->route, SurfaceCatalog::routes(), $tour->route);
            $this->assertSame([], PageTours::problems($tour->route, (array) $tour->steps), $tour->route);
            $this->assertNotSame('', trim($tour->overview), $tour->route);
            foreach (PageTours::validSteps((array) $tour->steps) as $step) {
                if ($step['do'] === 'press') {
                    $action = SurfaceCatalog::action(SurfaceCatalog::surface($step['surface']), $step['action']);
                    $this->assertEmpty($action['consequential'] ?? null, "{$tour->route} presses {$step['action']}");
                    $this->assertEmpty($action['destructive'] ?? null, "{$tour->route} presses {$step['action']}");
                }
            }
        }
    }

    public function test_a_page_is_explained_from_the_request_or_the_page_the_user_is_on()
    {
        $task = new AgentTask(['page_context' => ['currentPath' => '/approvals']]);
        $this->assertSame('/approvals', PageTours::routeFor([], $task));
        $this->assertSame('/connections', PageTours::routeFor(['page' => '/connections'], $task));
        $this->assertNull(PageTours::routeFor(['page' => '/not-a-page'], $task));

        $overview = PageTours::page('/approvals', 'overview');
        $this->assertSame([], $overview['steps']);
        $detailed = PageTours::page('/approvals', 'detailed');
        $this->assertSame('detailed', $detailed['depth']);
        $this->assertNotEmpty($detailed['steps']);

        OrbitPageTour::where('route', '/approvals')->update(['is_active' => false]);
        $this->assertNull(PageTours::page('/approvals', 'overview'));
        $this->assertNotContains('/approvals', array_column(PageTours::tourPages(), 'route'));
    }

    public function test_only_safe_steps_are_chained_and_explanations_offer_more_detail()
    {
        $this->assertTrue(AgentOrchestrator::chainable('go_to_page', ['page' => '/data']));
        $this->assertTrue(AgentOrchestrator::chainable('press', ['surface' => 'approvals.list', 'action' => 'open']));
        $this->assertFalse(AgentOrchestrator::chainable('press', ['surface' => 'approvals.list', 'action' => 'approve']));
        $this->assertFalse(AgentOrchestrator::chainable('press', ['surface' => 'connections.list', 'action' => 'remove']));
        $this->assertFalse(AgentOrchestrator::chainable('preview_data_change', []));

        $this->assertStringContainsString('detail', AgentOrchestrator::followUpOffer('explain_page', ['depth' => 'overview']));
        $this->assertSame('', AgentOrchestrator::followUpOffer('explain_page', ['depth' => 'detailed']));
        $this->assertStringContainsString('detail', AgentOrchestrator::followUpOffer('give_tour', []));
    }

    public function test_tours_are_managed_by_admins_who_manage_orbit_knowledge()
    {
        $this->actingAs($this->admin(Admin::SUPER_ADMIN), 'admin')->get('/admin/orbit-page-tours')->assertOk()->assertSee('Approvals');
    }

    public function test_support_admins_cannot_open_page_tours()
    {
        $this->actingAs($this->admin('support'), 'admin')->get('/admin/orbit-page-tours')->assertForbidden();
    }

    public function test_the_server_check_names_each_step_that_would_not_run()
    {
        $problems = PageTours::problems('/approvals', [
            ['do' => 'point', 'surface' => 'approvals.list', 'say' => 'Fine.'],
            ['do' => 'point', 'surface' => 'connections.form', 'say' => 'Wrong page.'],
            ['do' => 'press', 'surface' => 'approvals.list', 'action' => 'approve', 'say' => 'Approving.'],
            ['do' => 'press', 'surface' => 'approvals.list', 'say' => 'No button.'],
            ['do' => 'say', 'say' => ''],
        ]);

        $this->assertCount(4, $problems);
        $this->assertStringStartsWith('Step 2:', $problems[0]);
        $this->assertStringContainsString('not on this page', $problems[0]);
        $this->assertStringContainsString('changes data', $problems[1]);
        $this->assertStringContainsString('choose the button', $problems[2]);
        $this->assertStringContainsString('write what Orbit says', $problems[3]);
    }

    public function test_saving_a_tour_refuses_data_changing_presses_and_records_the_edit()
    {
        $editor = $this->admin('content_editor');
        $this->actingAs($editor, 'admin');
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $tour = OrbitPageTour::where('route', '/approvals')->firstOrFail();
        $before = (array) $tour->steps;

        Livewire::test(EditOrbitPageTour::class, ['record' => $tour->getRouteKey()])
            ->fillForm(['steps' => [['do' => 'press', 'surface' => 'approvals.list', 'action' => 'approve', 'say' => 'Approving it for you.']]])
            ->call('save')
            ->assertHasErrors();
        $this->assertSame($before, (array) $tour->fresh()->steps);

        Livewire::test(EditOrbitPageTour::class, ['record' => $tour->getRouteKey()])
            ->fillForm(['overview' => 'Drafts that wait for your decision.', 'steps' => [
                ['do' => 'point', 'surface' => 'approvals.list', 'say' => 'Every draft waiting for you is listed here.'],
                ['do' => 'say', 'say' => 'Nothing is published until you approve it.'],
            ]])
            ->call('save')
            ->assertHasNoErrors();

        $tour->refresh();
        $this->assertSame('Drafts that wait for your decision.', $tour->overview);
        $this->assertCount(2, $tour->steps);
        $this->assertSame([0, 1], array_keys($tour->steps), 'steps are stored as a list');
        $this->assertSame($editor->id, $tour->updated_by);
        $log = AdminActivityLog::where('action', 'orbit_page_tour.updated')->latest('id')->firstOrFail();
        $this->assertEquals(['from' => count($before) . ' steps', 'to' => '2 steps'], $log->changes['steps']);
    }

    public function test_customers_cannot_reach_tour_administration()
    {
        $this->actingAs(User::factory()->create())->get('/admin/orbit-page-tours')->assertRedirect();
    }
}
