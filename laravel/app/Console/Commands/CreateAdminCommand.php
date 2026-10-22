<?php

namespace App\Console\Commands;

use App\Models\Admin;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

use function Laravel\Prompts\password;
use function Laravel\Prompts\text;

/**
 * Creates an admin for the admin panel (/admin). There is no default account: the first admin is always created
 * here and is always a super admin; later admins are usually created in the panel by a super admin.
 */
class CreateAdminCommand extends Command
{
    protected $signature = 'admin:create {--name= : Full name} {--email= : Sign-in email} {--password= : Password (asked for when omitted)} {--super : Give the super admin role}';
    protected $description = 'Create an admin panel account (the first one is always a super admin)';

    public function handle(): int
    {
        $this->call('admin:sync-permissions');

        $name = $this->option('name') ?: text('Name', required: true);
        $email = $this->option('email') ?: text('Email', required: true);
        $plain = $this->option('password') ?: password('Password (12+ characters, letters and numbers)', required: true);

        $validator = Validator::make(compact('name', 'email') + ['password' => $plain], [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:255', 'unique:admins,email'],
            'password' => ['required', Password::min(12)->letters()->numbers()],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->error($message);
            }
            return self::FAILURE;
        }

        $first = !Admin::role(Admin::SUPER_ADMIN)->exists();
        $admin = Admin::create(['name' => $name, 'email' => $email, 'password' => $plain, 'is_active' => true]);
        if ($first || $this->option('super')) {
            $admin->assignRole(Admin::SUPER_ADMIN);
        }

        $this->info("Admin {$email} created" . ($admin->isSuperAdmin() ? ' as super admin' : '') . '. Sign in at ' . rtrim(config('app.url'), '/') . '/admin');
        return self::SUCCESS;
    }
}
