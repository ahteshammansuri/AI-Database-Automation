<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<\Database\Factories\UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'timezone',
        'privacy_mode',
        'agent_view_mode',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'suspended_at' => 'datetime',
            'last_active_at' => 'datetime',
        ];
    }

    /** Suspended by a platform admin: cannot sign in or use the API until reactivated. */
    public function isSuspended(): bool
    {
        return $this->suspended_at !== null;
    }

    public function connections(): HasMany
    {
        return $this->hasMany(DbConnection::class);
    }

    public function automations(): HasMany
    {
        return $this->hasMany(Automation::class);
    }

    public function executions(): HasMany
    {
        return $this->hasMany(AutomationExecution::class);
    }

    public function aiProviders(): HasMany
    {
        return $this->hasMany(AiProvider::class);
    }

    public function knowledgeDocuments(): HasMany
    {
        return $this->hasMany(KnowledgeDocument::class);
    }

    public function agentTasks(): HasMany
    {
        return $this->hasMany(AgentTask::class);
    }

    public function remoteSessions(): HasMany
    {
        return $this->hasMany(OrbitRemoteSession::class);
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class);
    }

    /** AI calls made for this customer (tokens per model and purpose). */
    public function aiUsageEvents(): HasMany
    {
        return $this->hasMany(AiUsageEvent::class);
    }
}
