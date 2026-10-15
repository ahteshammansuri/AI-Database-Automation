<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\MediaAsset;
use App\Services\MediaService;
use App\Services\DatabaseSafetyService;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use Exception;

class MediaServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    public function test_ssrf_dangerous_urls_are_blocked(): void
    {
        $service = app(MediaService::class);

        $blockedUrls = [
            'http://169.254.169.254/latest/meta-data/',
            'http://localhost/admin',
            'http://localhost:8000/secret',
            'ftp://example.com/image.jpg',
            'file:///etc/passwd',
            'gopher://127.0.0.1:6379/_flushall',
        ];

        foreach ($blockedUrls as $url) {
            $threw = false;
            try {
                $service->validateSafeUrl($url);
            } catch (Exception $e) {
                $threw = true;
                $this->assertStringContainsString('Security violation', $e->getMessage());
            }
            $this->assertTrue($threw, "URL '{$url}' should have been blocked by SSRF validator.");
        }
    }

    public function test_magic_bytes_detects_real_image_and_rejects_fake(): void
    {
        $service = app(MediaService::class);

        // 1. Real 1x1 PNG bytes
        $pngBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        $this->assertEquals('image/png', $service->detectMimeByMagicBytes($pngBytes));

        // 2. Real minimal JPEG header
        $jpegBytes = "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x01\x00\x60\x00\x60\x00\x00\xFF\xDB";
        $this->assertEquals('image/jpeg', $service->detectMimeByMagicBytes($jpegBytes));

        // 3. Fake image (PHP script masquerading as image)
        $fakeBytes = "<?php echo 'malicious payload'; ?>";
        $this->assertNull($service->detectMimeByMagicBytes($fakeBytes));

        // 4. Plaintext masquerading as JPEG
        $fakeJpeg = "This is not an image but text file";
        $this->assertNull($service->detectMimeByMagicBytes($fakeJpeg));
    }

    public function test_import_media_stores_file_and_deduplicates(): void
    {
        $user = User::factory()->create();
        $service = app(MediaService::class);

        // Valid 1x1 PNG
        $pngBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');

        // First import
        $asset1 = $service->importMedia($user->id, $pngBytes);
        $this->assertNotNull($asset1->id);
        $this->assertEquals('image/png', $asset1->mime_type);
        $this->assertTrue(Storage::disk('public')->exists($asset1->path));

        // Second import of same content should return the same asset
        $asset2 = $service->importMedia($user->id, $pngBytes);
        $this->assertEquals($asset1->id, $asset2->id);
        $this->assertEquals($asset1->hash, $asset2->hash);
    }

    public function test_format_value_for_column(): void
    {
        $user = User::factory()->create();
        $service = app(MediaService::class);

        $pngBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        $asset = $service->importMedia($user->id, $pngBytes);

        // image_url -> returns URL string
        $urlVal = $service->formatValueForColumn('image_url', 'varchar', $asset);
        $this->assertStringContainsString('storage/media/', $urlVal);

        // image_path -> returns relative path
        $pathVal = $service->formatValueForColumn('image_path', 'varchar', $asset);
        $this->assertEquals($asset->path, $pathVal);

        // media_ref -> returns integer ID
        $refVal = $service->formatValueForColumn('media_ref', 'int', $asset);
        $this->assertEquals($asset->id, $refVal);
    }

    public function test_rollback_staged_files_cleans_up_disk(): void
    {
        $user = User::factory()->create();
        $service = new MediaService(app(DatabaseSafetyService::class));

        $pngBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        $asset = $service->importMedia($user->id, $pngBytes);

        $this->assertTrue(Storage::disk('public')->exists($asset->path));

        // Simulate transaction abort and rollback cleanup
        $service->rollbackStagedFiles('public');

        $this->assertFalse(Storage::disk('public')->exists($asset->path), "Staged file should be deleted upon rollback.");
    }
}
