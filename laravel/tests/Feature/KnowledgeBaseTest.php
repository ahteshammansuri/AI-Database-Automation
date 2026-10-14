<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\KnowledgeDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class KnowledgeBaseTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_upload_and_index_knowledge_document(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        Http::fake([
            '*/v1/rag/index' => Http::response([
                'success' => true,
                'document_id' => 1,
                'user_id' => $user->id,
                'chunks_created' => 4,
                'total_vectors' => 4,
            ], 200),
        ]);

        $file = UploadedFile::fake()->createWithContent(
            'meal_diaries_guidelines.txt',
            "# Knowledge Base: Meal Diaries Daily Content Strategy\n\nProvide healthy, balanced dinner recipes with step-by-step instructions."
        );

        $response = $this->actingAs($user)->postJson('/api/knowledge', [
            'file' => $file,
            'title' => 'Meal Diaries Daily Strategy',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('document.title', 'Meal Diaries Daily Strategy')
            ->assertJsonPath('document.status', 'indexed')
            ->assertJsonPath('document.chunk_count', 4);

        $this->assertDatabaseHas('knowledge_documents', [
            'user_id' => $user->id,
            'title' => 'Meal Diaries Daily Strategy',
            'status' => 'indexed',
        ]);
    }

    public function test_user_can_list_and_delete_their_knowledge_document(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        $filePath = 'knowledge_docs/sample_test.txt';
        Storage::disk('local')->put($filePath, 'Sample text content');

        $doc = KnowledgeDocument::create([
            'user_id' => $user->id,
            'title' => 'Test Doc',
            'file_path' => $filePath,
            'file_type' => 'txt',
            'file_size' => 19,
            'chunk_count' => 1,
            'vector_count' => 1,
            'status' => 'indexed',
        ]);

        Http::fake([
            '*/v1/rag/index/*' => Http::response(['success' => true], 200),
        ]);

        // List
        $listRes = $this->actingAs($user)->getJson('/api/knowledge');
        $listRes->assertStatus(200)
            ->assertJsonFragment(['title' => 'Test Doc']);

        // Delete
        $delRes = $this->actingAs($user)->deleteJson("/api/knowledge/{$doc->id}");
        $delRes->assertStatus(200);

        $this->assertDatabaseMissing('knowledge_documents', ['id' => $doc->id]);
        $this->assertFalse(Storage::disk('local')->exists($filePath));
    }

    public function test_user_cannot_delete_another_users_document(): void
    {
        $userA = User::factory()->create();
        $userB = User::factory()->create();

        $doc = KnowledgeDocument::create([
            'user_id' => $userA->id,
            'title' => 'User A Doc',
            'file_path' => 'knowledge_docs/user_a.txt',
            'file_type' => 'txt',
            'file_size' => 50,
            'status' => 'indexed',
        ]);

        $response = $this->actingAs($userB)->deleteJson("/api/knowledge/{$doc->id}");
        $response->assertStatus(404);

        $this->assertDatabaseHas('knowledge_documents', ['id' => $doc->id]);
    }
}
