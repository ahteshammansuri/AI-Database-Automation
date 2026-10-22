<?php

namespace App\Admin;

use App\Models\AuditLog;
use App\Models\KnowledgeDocument;
use App\Models\MediaAsset;
use App\Models\OrbitRemoteSession;
use App\Models\User;
use App\Services\AiServiceClient;
use App\Services\Orbit\OrbitRemoteService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * What a platform admin can do to a customer account. Each action is recorded twice: in the admin activity log
 * (who did it) and in the customer's own audit log (what happened to the account).
 */
final class CustomerAccounts
{
    public function __construct(private OrbitRemoteService $remote, private AiServiceClient $ai) {}

    public function suspend(User $user, string $reason): void
    {
        $user->forceFill(['suspended_at' => now(), 'suspension_reason' => $reason])->save();
        $tokens = $this->signOut($user, 'suspended');
        AuditLog::log($user->id, 'ACCOUNT_SUSPENDED', 'User', (string) $user->id, ['reason' => $reason]);
        AdminActivity::record('customer.suspended', $user, ['reason' => $reason, 'signed_out_sessions' => $tokens]);
    }

    public function reactivate(User $user): void
    {
        $user->forceFill(['suspended_at' => null, 'suspension_reason' => null])->save();
        AuditLog::log($user->id, 'ACCOUNT_REACTIVATED', 'User', (string) $user->id);
        AdminActivity::record('customer.reactivated', $user);
    }

    public function signOutEverywhere(User $user): int
    {
        $tokens = $this->signOut($user, 'signed_out_by_admin');
        AuditLog::log($user->id, 'SIGNED_OUT_BY_ADMIN', 'User', (string) $user->id, ['sessions' => $tokens]);
        AdminActivity::record('customer.signed_out', $user, ['sessions' => $tokens]);
        return $tokens;
    }

    /**
     * Delete the account and everything it owns. Rows cascade in the database; files on disk and the customer's
     * vector index in the AI service are removed here (they are not rows).
     */
    public function delete(User $user): void
    {
        $label = "{$user->name} <{$user->email}>";
        $id = $user->id;
        $this->signOut($user, 'account_deleted');

        foreach (KnowledgeDocument::where('user_id', $id)->get() as $doc) {
            try {
                $this->ai->deleteDocument($id, $doc->id);
            } catch (\Throwable $e) {
                Log::info("Vector purge for document {$doc->id} skipped: " . $e->getMessage());
            }
            if ($doc->file_path && Storage::disk('local')->exists($doc->file_path)) {
                Storage::disk('local')->delete($doc->file_path);
            }
        }
        foreach (MediaAsset::where('user_id', $id)->get() as $asset) {
            try {
                if ($asset->path && Storage::disk($asset->disk ?: 'public')->exists($asset->path)) {
                    Storage::disk($asset->disk ?: 'public')->delete($asset->path);
                }
            } catch (\Throwable $e) {
                Log::info("Media file {$asset->id} not removed: " . $e->getMessage());
            }
        }

        DB::transaction(fn () => $user->delete());
        AdminActivity::record('customer.deleted', 'User', ['user_id' => $id], $label);
    }

    /** Revoke every API token and disconnect paired phones. Returns the number of tokens revoked. */
    private function signOut(User $user, string $reason): int
    {
        $count = $user->tokens()->count();
        $user->tokens()->delete();
        OrbitRemoteSession::where('user_id', $user->id)->whereIn('status', ['pending', 'active'])->get()
            ->each(fn (OrbitRemoteSession $s) => $this->remote->end($s, $reason));
        return $count;
    }
}
