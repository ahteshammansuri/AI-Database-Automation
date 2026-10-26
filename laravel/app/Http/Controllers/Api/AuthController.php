<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        // Sign-up can be closed by a platform admin (Settings > Sign-up & limits).
        if (!config('platform.registration_open', true)) {
            $message = (string) config('platform.registration_closed_message', 'New sign-ups are paused for now.');
            return response()->json(['message' => $message, 'errors' => ['email' => [$message]], 'reason' => 'registration_closed'], 403);
        }

        $min = max(6, (int) config('platform.password_min_length', 6));
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users,email',
            'password' => "required|string|min:{$min}|max:255|confirmed",
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
        ]);

        $token = $user->createToken('api_token')->plainTextToken;

        AuditLog::log($user->id, 'USER_REGISTERED', 'User', (string) $user->id, [
            'email' => $user->email,
        ]);

        return response()->json([
            'message' => 'Registration successful',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'timezone' => $user->timezone,
            ],
            'token' => $token,
        ], 201);
    }

    public function login(Request $request)
    {
        $validated = $request->validate([
            'email' => 'required|string|email',
            'password' => 'required|string',
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            throw ValidationException::withMessages([
                'password' => ['The email or password is incorrect.'],
            ]);
        }

        if ($user->isSuspended()) {
            $support = config('platform.support_email');
            throw ValidationException::withMessages([
                'email' => ['This account is suspended.' . ($support ? " Contact {$support} for help." : '')],
            ]);
        }

        $token = $user->createToken('api_token')->plainTextToken;

        AuditLog::log($user->id, 'USER_LOGIN', 'User', (string) $user->id);

        return response()->json([
            'message' => 'Login successful',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'timezone' => $user->timezone,
            ],
            'token' => $token,
        ]);
    }

    public function me(Request $request)
    {
        return response()->json([
            'user' => [
                'id' => $request->user()->id,
                'name' => $request->user()->name,
                'email' => $request->user()->email,
                'timezone' => $request->user()->timezone,
            ],
        ]);
    }

    public function logout(Request $request)
    {
        // A phone paired with this tab must not keep acting after the sign-out.
        $token = $request->user()->currentAccessToken();
        if ($token instanceof \Laravel\Sanctum\PersonalAccessToken) {
            app(\App\Services\Orbit\OrbitRemoteService::class)->endForToken($request->user()->id, (int) $token->id, 'signed_out');
        }
        $request->user()->currentAccessToken()->delete();

        return response()->json([
            'message' => 'Logged out successfully',
        ]);
    }
}
