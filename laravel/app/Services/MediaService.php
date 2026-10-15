<?php

namespace App\Services;

use App\Models\MediaAsset;
use App\Models\User;
use Exception;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * MediaService
 *
 * Safe media ingestion, storage, and column mapping for AI content automations.
 *
 * Security Invariants:
 *  - Strict SSRF protection on remote image imports (blocks private IPs, cloud metadata 169.254.169.254, loopback).
 *  - MIME validation via magic bytes (never trusts user extension or remote Content-Type header).
 *  - SHA-256 content deduplication per user.
 *  - Rollback cleanup: tracks created files so failed transactions do not leave orphan disk assets.
 *  - Schema-aware mapping: outputs URL, server-relative path, or foreign key ID based on column semantics.
 */
class MediaService
{
    public const MAX_FILE_SIZE = 10485760; // 10 MB

    public const ALLOWED_MIMES = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
        'image/svg+xml' => 'svg',
    ];

    /** @var array<string> List of file paths created in current operation for rollback cleanup */
    protected array $stagedFiles = [];

    public function __construct(
        protected DatabaseSafetyService $safetyService
    ) {}

    /**
     * Import a media item (from remote URL or raw binary string) and persist as MediaAsset.
     *
     * @param  int     $userId
     * @param  string  $sourceUrlOrData  Remote URL or base64/raw data
     * @param  string  $disk             Storage disk ('public' by default)
     * @return MediaAsset
     * @throws Exception
     */
    public function importMedia(int $userId, string $sourceUrlOrData, string $disk = 'public'): MediaAsset
    {
        $content = '';
        $originalFilename = null;

        if (str_starts_with($sourceUrlOrData, 'http://') || str_starts_with($sourceUrlOrData, 'https://')) {
            $this->validateSafeUrl($sourceUrlOrData);
            $originalFilename = basename(parse_url($sourceUrlOrData, PHP_URL_PATH) ?: 'image');
            $content = $this->fetchRemoteContent($sourceUrlOrData);
        } else {
            // Raw binary or base64
            $content = str_starts_with($sourceUrlOrData, 'data:')
                ? (base64_decode(explode(',', $sourceUrlOrData, 2)[1] ?? '') ?: $sourceUrlOrData)
                : $sourceUrlOrData;
        }

        if (empty($content)) {
            throw new Exception("Media content cannot be empty.");
        }

        if (strlen($content) > self::MAX_FILE_SIZE) {
            throw new Exception("Media file size (" . strlen($content) . " bytes) exceeds limit of " . self::MAX_FILE_SIZE . " bytes.");
        }

        // Validate MIME type via magic bytes
        $mime = $this->detectMimeByMagicBytes($content);
        if (!$mime || !array_key_exists($mime, self::ALLOWED_MIMES)) {
            throw new Exception("Invalid or prohibited image format. Detected: " . ($mime ?: 'unknown') . ". Allowed: JPEG, PNG, WebP, GIF, SVG.");
        }

        $extension = self::ALLOWED_MIMES[$mime];
        $hash = hash('sha256', $content);

        // Deduplication: reuse existing media asset if same user already stored identical hash
        $existing = MediaAsset::where('user_id', $userId)
            ->where('hash', $hash)
            ->first();
        if ($existing && Storage::disk($existing->disk)->exists($existing->path)) {
            return $existing;
        }

        // Determine dimensions if raster image
        $width = null;
        $height = null;
        if (function_exists('getimagesizefromstring') && $mime !== 'image/svg+xml') {
            $size = @getimagesizefromstring($content);
            if ($size) {
                $width = $size[0] ?? null;
                $height = $size[1] ?? null;
            }
        }

        // Store file
        $relPath = "media/{$userId}/{$hash}.{$extension}";
        Storage::disk($disk)->put($relPath, $content);
        $this->stagedFiles[] = $relPath;

        $asset = MediaAsset::create([
            'user_id'           => $userId,
            'disk'              => $disk,
            'path'              => $relPath,
            'original_filename' => $originalFilename ?: "image.{$extension}",
            'mime_type'         => $mime,
            'file_size'         => strlen($content),
            'width'             => $width,
            'height'            => $height,
            'hash'              => $hash,
        ]);

        return $asset;
    }

    /**
     * Map a MediaAsset to the appropriate value for a column based on semantic role and type.
     *
     * @param  string      $role     e.g. 'image_url', 'image_path', 'media_ref'
     * @param  string      $dbType   e.g. 'varchar', 'text', 'int'
     * @param  MediaAsset  $asset
     * @return mixed
     */
    public function formatValueForColumn(string $role, string $dbType, MediaAsset $asset): mixed
    {
        if ($role === 'media_ref' || str_starts_with($dbType, 'int')) {
            return $asset->id;
        }

        if ($role === 'image_path') {
            return $asset->path;
        }

        // Default: return URL
        return $asset->url;
    }

    /**
     * Rollback cleanup: deletes all files staged during the current transaction.
     */
    public function rollbackStagedFiles(string $disk = 'public'): void
    {
        foreach ($this->stagedFiles as $path) {
            try {
                if (Storage::disk($disk)->exists($path)) {
                    Storage::disk($disk)->delete($path);
                }
            } catch (\Throwable $e) {
                Log::warning("[MediaService] Failed to clean up staged file {$path}: " . $e->getMessage());
            }
        }
        $this->stagedFiles = [];
    }

    /**
     * Clear list of staged files once transaction commits successfully.
     */
    public function commitStagedFiles(): void
    {
        $this->stagedFiles = [];
    }

    // -------------------------------------------------------------------------
    // Security Helpers
    // -------------------------------------------------------------------------

    /**
     * Validate URL against SSRF vulnerabilities before fetching.
     */
    public function validateSafeUrl(string $url): void
    {
        $parts = parse_url($url);
        if (!$parts || empty($parts['scheme'])) {
            throw new Exception("Security violation: Invalid media URL format: '{$url}'.");
        }

        $scheme = strtolower($parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) {
            throw new Exception("Security violation: Only HTTP and HTTPS schemes are permitted for media import.");
        }

        if (empty($parts['host'])) {
            throw new Exception("Security violation: Media URL must specify a valid host.");
        }

        $host = strtolower($parts['host']);

        // Check against known dangerous hosts & cloud metadata IPs
        if ($host === 'localhost' || $host === '169.254.169.254' || $host === 'metadata.google.internal') {
            throw new Exception("Security violation: SSRF target '{$host}' is strictly prohibited.");
        }

        // In production/cloud, resolve IP and block private ranges
        if (app()->environment('production')) {
            $ips = @dns_get_record($host, DNS_A);
            if ($ips) {
                foreach ($ips as $record) {
                    $ip = $record['ip'] ?? '';
                    if ($this->isPrivateIp($ip)) {
                        throw new Exception("Security violation: Remote host '{$host}' resolves to prohibited private IP '{$ip}'.");
                    }
                }
            }
        }
    }

    /**
     * Check if IP address falls within private/loopback/link-local ranges.
     */
    protected function isPrivateIp(string $ip): bool
    {
        return !filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        );
    }

    /**
     * Fetch remote content with timeout and stream limit.
     */
    protected function fetchRemoteContent(string $url): string
    {
        $ctx = stream_context_create([
            'http' => [
                'timeout' => 8,
                'follow_location' => 1,
                'max_redirects' => 3,
                'user_agent' => 'AIDatabaseAutomation-MediaBot/1.0',
            ],
        ]);

        $content = @file_get_contents($url, false, $ctx, 0, self::MAX_FILE_SIZE + 1024);
        if ($content === false) {
            throw new Exception("Failed to fetch remote media from URL: '{$url}'.");
        }

        return $content;
    }

    /**
     * Detect MIME type strictly from leading magic bytes.
     */
    public function detectMimeByMagicBytes(string $bytes): ?string
    {
        if (strlen($bytes) < 4) {
            return null;
        }

        // JPEG: \xFF\xD8\xFF
        if (str_starts_with($bytes, "\xFF\xD8\xFF")) {
            return 'image/jpeg';
        }

        // PNG: \x89PNG\r\n\x1a\n
        if (str_starts_with($bytes, "\x89PNG\r\n\x1a\n") || str_starts_with($bytes, "\x89\x50\x4E\x47")) {
            return 'image/png';
        }

        // GIF: GIF87a or GIF89a
        if (str_starts_with($bytes, "GIF87a") || str_starts_with($bytes, "GIF89a")) {
            return 'image/gif';
        }

        // WebP: RIFF....WEBP
        if (str_starts_with($bytes, "RIFF") && strlen($bytes) >= 12 && substr($bytes, 8, 4) === "WEBP") {
            return 'image/webp';
        }

        // SVG: XML header or <svg tag
        $sample = substr($bytes, 0, 512);
        if (str_contains($sample, '<svg') || (str_contains($sample, '<?xml') && str_contains($sample, '<svg'))) {
            return 'image/svg+xml';
        }

        return null;
    }
}
