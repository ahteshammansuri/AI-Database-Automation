<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Settings\PlatformSettings;
use Illuminate\Http\JsonResponse;

/**
 * Public, read-only values the portal and the website use, as managed in the admin panel: settings marked public
 * (sign-up open, minimum review window, Orbit on/off, feature flags ...) and the website content.
 */
class PlatformController extends Controller
{
    public function config(): JsonResponse
    {
        return response()->json(PlatformSettings::publicConfig())->header('Cache-Control', 'no-cache');
    }

    public function content(): JsonResponse
    {
        return response()->json(PlatformSettings::content())->header('Cache-Control', 'no-cache');
    }
}
