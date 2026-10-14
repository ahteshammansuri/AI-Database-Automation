<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogController extends Controller
{
    public function index(Request $request)
    {
        $logs = AuditLog::where('user_id', $request->user()->id)
            ->orderBy('created_at', 'desc')
            ->paginate(30);

        return response()->json($logs);
    }
}
