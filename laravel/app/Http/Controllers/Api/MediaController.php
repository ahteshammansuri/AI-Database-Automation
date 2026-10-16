<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Services\MediaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Image upload for manual publishing: stores the file as a MediaAsset (magic-byte validated,
 * per-user dedup) and returns its public URL, so image columns receive a URL instead of a
 * base64 blob that would not fit (or would be truncated) in a VARCHAR column.
 */
class MediaController extends Controller
{
    public function upload(Request $request, MediaService $media): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|max:10240|mimetypes:image/jpeg,image/png,image/webp,image/gif',
        ]);

        try {
            $asset = $media->importMedia($request->user()->id, (string) file_get_contents($request->file('file')->getRealPath()));
            $media->commitStagedFiles();
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        AuditLog::log($request->user()->id, 'MEDIA_UPLOADED', 'MediaAsset', (string) $asset->id, [
            'mime' => $asset->mime_type,
            'bytes' => $asset->file_size,
        ]);

        return response()->json([
            'id' => $asset->id,
            'url' => $asset->url,
            'path' => $asset->path,
            'width' => $asset->width,
            'height' => $asset->height,
            'mime_type' => $asset->mime_type,
        ], 201);
    }
}
