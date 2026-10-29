<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\OrbitPage;
use App\Models\OrbitSurface;
use App\Models\OrbitTool;
use App\Models\User;
use App\Services\Agent\AgentToolRegistry;
use App\Services\Agent\SurfaceCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrbitDynamicAdminCatalogTest extends TestCase
{
    use RefreshDatabase;

    public function test_surface_catalog_loads_from_database(): void
    {
        SurfaceCatalog::flushCache();

        $page = OrbitPage::create([
            'route' => '/custom-portal-page',
            'title' => 'Custom Portal Page',
            'is_active' => true,
            'sort' => 99,
        ]);

        $surface = OrbitSurface::create([
            'id' => 'custom.card',
            'route' => '/custom-portal-page',
            'title' => 'Custom Interactive Card',
            'purpose' => 'A dynamic card created by administrator.',
            'openable' => false,
            'fields' => [
                ['name' => 'query', 'label' => 'Search term', 'type' => 'text', 'required' => true],
            ],
            'actions' => [
                ['id' => 'search_btn', 'label' => 'Search Now', 'consequential' => false, 'timeout_s' => 15],
            ],
            'is_active' => true,
            'sort' => 10,
        ]);

        SurfaceCatalog::flushCache();

        $this->assertContains('/custom-portal-page', SurfaceCatalog::routes());

        $retrieved = SurfaceCatalog::surface('custom.card');
        $this->assertNotNull($retrieved);
        $this->assertSame('Custom Interactive Card', $retrieved['title']);
        $this->assertSame('/custom-portal-page', $retrieved['route']);
        $this->assertCount(1, $retrieved['fields']);
        $this->assertSame('query', $retrieved['fields'][0]['name']);
    }

    public function test_deactivating_surface_in_database_hides_it_from_catalog(): void
    {
        $surface = OrbitSurface::create([
            'id' => 'temp.surface',
            'route' => '/dashboard',
            'title' => 'Temporary Surface',
            'is_active' => true,
            'sort' => 10,
        ]);

        SurfaceCatalog::flushCache();
        $this->assertNotNull(SurfaceCatalog::surface('temp.surface'));

        // Deactivate
        $surface->update(['is_active' => false]);
        SurfaceCatalog::flushCache();

        $this->assertNull(SurfaceCatalog::surface('temp.surface'));
    }

    public function test_agent_tool_registry_loads_dynamically_from_database(): void
    {
        AgentToolRegistry::flushCache();

        OrbitTool::create([
            'name' => 'custom_dynamic_tool',
            'label' => 'Dynamic Admin Tool',
            'category' => 'general',
            'description' => 'A dynamically administered tool for testing.',
            'scope' => 'tenant_user',
            'read_only' => true,
            'risk_level' => 'LOW',
            'is_active' => true,
            'sort' => 99,
        ]);

        AgentToolRegistry::flushCache();

        $tool = AgentToolRegistry::definition('custom_dynamic_tool');
        $this->assertNotNull($tool);
        $this->assertSame('Dynamic Admin Tool', $tool['label']);
        $this->assertSame('A dynamically administered tool for testing.', $tool['description']);
    }

    public function test_disabling_tool_in_admin_panel_blocks_execution(): void
    {
        $user = User::factory()->create();

        $tool = OrbitTool::create([
            'name' => 'guarded_admin_test_tool',
            'label' => 'Guarded Tool',
            'category' => 'general',
            'description' => 'Guarded capability.',
            'is_active' => false, // Admin disabled this tool
            'sort' => 1,
        ]);

        AgentToolRegistry::flushCache();

        // Execution must be rejected with TOOL_DISABLED
        $res = AgentToolRegistry::executeTool($user, 'guarded_admin_test_tool', []);
        $this->assertFalse($res['success']);
        $this->assertSame('TOOL_DISABLED', $res['error_category']);
        $this->assertStringContainsString('disabled', $res['error']);

        // Re-enable
        $tool->update(['is_active' => true]);
        AgentToolRegistry::flushCache();

        // Now allowed past the disabled check (falls to switch handler)
        $res2 = AgentToolRegistry::executeTool($user, 'guarded_admin_test_tool', []);
        $this->assertNotSame('TOOL_DISABLED', $res2['error_category'] ?? null);
    }
}
