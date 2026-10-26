<?php

namespace Tests\Feature;

use App\Models\OrbitRemoteCommand;
use App\Models\OrbitRemoteSession;
use App\Models\User;
use App\Services\Orbit\OrbitRemoteService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Orbit Remote: a phone paired by QR code sends requests to the signed-in tab and mirrors the web Orbit.
 */
class OrbitRemoteTest extends TestCase
{
    use RefreshDatabase;

    private const INSTANCE = 'tab_AAAAAAAAAAAA';
    private const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

    private User $user;
    private string $desktopToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create(['name' => 'Asha Rao']);
        $this->desktopToken = $this->user->createToken('portal')->plainTextToken;
    }

    /** @return array{0: string, 1: string} public id and pairing code */
    private function pair(string $instance = self::INSTANCE, ?string $token = null): array
    {
        $res = $this->withToken($token ?? $this->desktopToken)->postJson('/api/orbit-remote/sessions', ['instance' => $instance]);
        $res->assertCreated()->assertJsonPath('session.status', 'pending');
        return [$res->json('session.id'), $res->json('code')];
    }

    /** @return array{0: string, 1: string} public id and device token */
    private function connectPhone(): array
    {
        [$id, $code] = $this->pair();
        $res = $this->withHeader('User-Agent', self::PHONE_UA)->postJson('/api/orbit-remote/claim', ['code' => $code]);
        $res->assertCreated();
        $this->app['auth']->forgetGuards();
        return [$id, $res->json('device_token')];
    }

    private function desktopHeartbeat(string $id, array $state = ['face' => 'idle']): void
    {
        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/state", ['instance' => self::INSTANCE, 'state' => $state])
            ->assertOk();
        $this->app['auth']->forgetGuards();
    }

    public function test_pairing_code_is_single_use_and_stored_only_as_a_hash()
    {
        [$id, $code] = $this->pair();
        $row = OrbitRemoteSession::where('public_id', $id)->first();
        $this->assertSame(hash('sha256', $code), $row->pairing_code_hash);
        $this->assertStringNotContainsString($code, json_encode($row->getAttributes()) ?: '');

        $first = $this->withHeader('User-Agent', self::PHONE_UA)->postJson('/api/orbit-remote/claim', ['code' => $code]);
        $first->assertCreated()
            ->assertJsonPath('session.id', $id)
            ->assertJsonPath('session.device_label', 'iPhone · Safari')
            ->assertJsonPath('session.owner_first_name', 'Asha');
        $token = $first->json('device_token');
        $this->assertSame(hash('sha256', $token), $row->fresh()->device_token_hash);
        $this->assertNull($row->fresh()->pairing_code_hash);

        $this->postJson('/api/orbit-remote/claim', ['code' => $code])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', 'This QR code was already used or is no longer valid. Show a new one on your computer.');
        $this->assertDatabaseHas('audit_logs', ['action' => 'ORBIT_REMOTE_PAIRED', 'resource_id' => $id]);
    }

    public function test_an_expired_code_cannot_be_claimed()
    {
        [$id, $code] = $this->pair();
        OrbitRemoteSession::where('public_id', $id)->update(['pairing_expires_at' => now()->subSecond()]);

        $this->postJson('/api/orbit-remote/claim', ['code' => $code])
            ->assertStatus(422)
            ->assertJsonPath('errors.code.0', 'This QR code has expired. Show a new one on your computer and scan it again.');
        $this->assertSame('ended', OrbitRemoteSession::where('public_id', $id)->value('status'));
    }

    public function test_device_token_only_works_on_the_remote_endpoints()
    {
        [, $device] = $this->connectPhone();

        $this->withToken($device)->getJson('/api/orbit-remote/device/session')->assertOk()->assertJsonPath('session.status', 'active');
        $this->app['auth']->forgetGuards();
        $this->withToken($device)->getJson('/api/auth/me')->assertStatus(401);
        $this->app['auth']->forgetGuards();
        $this->withToken($device)->getJson('/api/connections')->assertStatus(401);
        $this->app['auth']->forgetGuards();
        // ...and a normal sign-in token is not a device token.
        $this->withToken($this->desktopToken)->getJson('/api/orbit-remote/device/session')->assertStatus(401)->assertJsonPath('reason', 'not_connected');
    }

    public function test_requests_reach_the_paired_tab_and_are_acknowledged()
    {
        [$id, $device] = $this->connectPhone();

        // Computer not reporting: refused (nothing runs later by surprise).
        OrbitRemoteSession::where('public_id', $id)->update(['last_desktop_seen_at' => now()->subMinutes(5)]);
        $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'say', 'text' => 'open connections'])
            ->assertStatus(422)
            ->assertJsonPath('errors.text.0', 'Your computer is not connected right now. Open ' . config('platform.brand_name') . ' there, then try again.');

        $this->desktopHeartbeat($id, ['face' => 'thinking', 'status' => 'Thinking', 'task' => 'Open connections']);
        $sent = $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'say', 'text' => 'Open the connections page']);
        $sent->assertCreated()->assertJsonPath('command.status', 'sent');
        $commandId = $sent->json('command.id');

        $event = DB::table('workspace_events')->where('user_id', $this->user->id)->where('event_type', 'orbit.remote_command')->latest('id')->first();
        $payload = json_decode($event->payload, true);
        $this->assertSame('Open the connections page', $payload['text']);
        $this->assertSame(self::INSTANCE, $payload['instance']);
        $this->assertSame($commandId, $payload['command_id']);

        $this->app['auth']->forgetGuards();
        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/commands/{$commandId}/ack", ['instance' => self::INSTANCE, 'status' => 'received'])
            ->assertOk()->assertJsonPath('command.status', 'received');
        $this->assertSame('received', OrbitRemoteCommand::find($commandId)->status);
        // A second tab with the same id (e.g. a duplicated tab) does not run it again.
        $this->app['auth']->forgetGuards();
        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/commands/{$commandId}/ack", ['instance' => self::INSTANCE, 'status' => 'received'])
            ->assertOk()->assertJsonPath('command.status', 'duplicate');

        // A request that reaches the tab late is refused by the server's clock, so it never runs by surprise.
        $this->app['auth']->forgetGuards();
        $late = $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'say', 'text' => 'open approvals'])->json('command.id');
        OrbitRemoteCommand::whereKey($late)->update(['created_at' => now()->subMinute()]);
        $this->app['auth']->forgetGuards();
        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/commands/{$late}/ack", ['instance' => self::INSTANCE, 'status' => 'received'])
            ->assertOk()->assertJsonPath('command.status', 'rejected');
        $this->assertSame('too_old', OrbitRemoteCommand::find($late)->reason);

        // The phone sees the tab's latest state and the request's status.
        $this->app['auth']->forgetGuards();
        $this->withToken($device)->getJson('/api/orbit-remote/device/session')
            ->assertOk()
            ->assertJsonPath('desktop.online', true)
            ->assertJsonPath('desktop.state.face', 'thinking')
            ->assertJsonPath('desktop.state.task', 'Open connections')
            ->assertJsonPath('commands.0.status', 'rejected')
            ->assertJsonPath('commands.1.status', 'received');
        $this->assertDatabaseHas('audit_logs', ['action' => 'ORBIT_REMOTE_COMMAND', 'resource_id' => $id]);
    }

    public function test_passwords_and_keys_are_never_sent_from_the_phone()
    {
        [$id, $device] = $this->connectPhone();
        $this->desktopHeartbeat($id);

        foreach (['connect blog db, my password is hunter22', 'use API key sk-abcdefghijklmnopqrstuvwxyz123', 'the database password: Secr3t!'] as $text) {
            $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'say', 'text' => $text])
                ->assertStatus(422)
                ->assertJsonPath('errors.text.0', "For your safety, passwords and API keys are never sent from your phone. Type them on the computer, in Orbit's secure field.");
        }
        $this->assertSame(0, OrbitRemoteCommand::count());
        $this->assertFalse(OrbitRemoteService::containsSecret('set the password to the same as before'));
        $this->assertFalse(OrbitRemoteService::containsSecret('open the knowledge base'));
    }

    public function test_requests_are_validated_and_rate_limited()
    {
        [$id, $device] = $this->connectPhone();
        $this->desktopHeartbeat($id);

        $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'say', 'text' => ''])
            ->assertStatus(422)->assertJsonPath('errors.text.0', 'Say or type what Orbit should do.');
        $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'delete_everything'])
            ->assertStatus(422)->assertJsonValidationErrors('kind');

        for ($i = 0; $i < 20; $i++) {
            $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'stop'])->assertCreated();
        }
        $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'stop'])->assertStatus(429);
    }

    public function test_only_one_tab_controls_the_phone_until_it_goes_quiet()
    {
        [$id] = $this->connectPhone();
        $this->desktopHeartbeat($id);

        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/attach", ['instance' => 'tab_BBBBBBBBBBBB'])
            ->assertStatus(409);
        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/state", ['instance' => 'tab_BBBBBBBBBBBB'])
            ->assertStatus(409);

        OrbitRemoteSession::where('public_id', $id)->update(['last_desktop_seen_at' => now()->subMinutes(2)]);
        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/attach", ['instance' => 'tab_BBBBBBBBBBBB'])
            ->assertOk()->assertJsonPath('session.attached_here', true);
    }

    public function test_another_account_cannot_see_or_end_the_session()
    {
        [$id] = $this->connectPhone();
        $other = User::factory()->create()->createToken('portal')->plainTextToken;

        $this->withToken($other)->deleteJson("/api/orbit-remote/sessions/{$id}")->assertStatus(404);
        $this->withToken($other)->postJson("/api/orbit-remote/sessions/{$id}/state", ['instance' => self::INSTANCE])->assertStatus(404);
        $this->withToken($other)->getJson('/api/orbit-remote/sessions/current')->assertOk()->assertJsonPath('session', null);
        $this->assertSame('active', OrbitRemoteSession::where('public_id', $id)->value('status'));
    }

    public function test_disconnecting_from_the_computer_or_a_new_code_ends_the_phone()
    {
        [$id, $device] = $this->connectPhone();
        $this->withToken($this->desktopToken)->deleteJson("/api/orbit-remote/sessions/{$id}")->assertOk()->assertJsonPath('session.status', 'ended');
        $this->app['auth']->forgetGuards();
        $this->withToken($device)->getJson('/api/orbit-remote/device/session')
            ->assertStatus(401)
            ->assertJsonPath('reason', 'disconnected_from_computer')
            ->assertJsonPath('message', 'The computer disconnected this phone.');

        [$id2, $device2] = $this->connectPhone();
        $this->pair(); // a new code replaces the connected phone
        $this->app['auth']->forgetGuards();
        $this->withToken($device2)->getJson('/api/orbit-remote/device/session')->assertStatus(401)->assertJsonPath('reason', 'replaced');
        $this->assertDatabaseHas('audit_logs', ['action' => 'ORBIT_REMOTE_ENDED', 'resource_id' => $id2]);
    }

    public function test_the_phone_can_disconnect_itself()
    {
        [$id, $device] = $this->connectPhone();
        $this->withToken($device)->postJson('/api/orbit-remote/device/end')->assertOk();
        $this->assertSame('disconnected_from_phone', OrbitRemoteSession::where('public_id', $id)->value('end_reason'));
        $this->withToken($device)->postJson('/api/orbit-remote/device/commands', ['kind' => 'stop'])->assertStatus(401);
    }

    public function test_signing_out_of_the_pairing_tab_disconnects_the_phone_but_other_tabs_do_not()
    {
        [, $device] = $this->connectPhone();
        $otherTab = $this->user->createToken('portal')->plainTextToken;

        $this->withToken($otherTab)->postJson('/api/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($device)->getJson('/api/orbit-remote/device/session')->assertOk();

        $this->app['auth']->forgetGuards();
        $this->withToken($this->desktopToken)->postJson('/api/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($device)->getJson('/api/orbit-remote/device/session')->assertStatus(401)->assertJsonPath('reason', 'signed_out');
    }

    public function test_idle_or_old_sessions_expire()
    {
        [$id, $device] = $this->connectPhone();
        OrbitRemoteSession::where('public_id', $id)->update(['last_device_seen_at' => now()->subHours(3)]);
        $this->withToken($device)->getJson('/api/orbit-remote/device/session')->assertStatus(401)->assertJsonPath('reason', 'expired');
        $this->assertSame('ended', OrbitRemoteSession::where('public_id', $id)->value('status'));
    }

    public function test_socket_access_is_limited_to_the_phones_own_channel()
    {
        [$id, $device] = $this->connectPhone();

        $ok = $this->withToken($device)->postJson('/api/orbit-remote/device/broadcasting/auth', [
            'socket_id' => '123.456', 'channel_name' => "private-orbit-remote.{$id}",
        ]);
        $ok->assertOk();
        $this->assertNotEmpty($ok->json('auth'));

        $this->withToken($device)->postJson('/api/orbit-remote/device/broadcasting/auth', [
            'socket_id' => '123.456', 'channel_name' => "private-workspace.{$this->user->id}",
        ])->assertStatus(422);

        // The signed-in tab joins the same channel through the normal route; another account cannot.
        $this->app['auth']->forgetGuards();
        $this->withToken($this->desktopToken)->postJson('/api/broadcasting/auth', [
            'socket_id' => '123.456', 'channel_name' => "private-orbit-remote.{$id}",
        ])->assertOk();
        $this->app['auth']->forgetGuards();
        $other = User::factory()->create()->createToken('portal')->plainTextToken;
        $this->withToken($other)->postJson('/api/broadcasting/auth', [
            'socket_id' => '123.456', 'channel_name' => "private-orbit-remote.{$id}",
        ])->assertStatus(403);
    }

    public function test_state_updates_are_validated()
    {
        [$id] = $this->connectPhone();
        $this->withToken($this->desktopToken)->postJson("/api/orbit-remote/sessions/{$id}/state", [
            'instance' => self::INSTANCE, 'state' => ['face' => '<script>', 'caption' => str_repeat('x', 601), 'needs' => 'root'],
        ])->assertStatus(422)->assertJsonValidationErrors(['state.face', 'state.caption', 'state.needs']);
    }

    public function test_labels_and_addresses()
    {
        $this->assertSame('Android phone · Chrome', OrbitRemoteService::browserLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', 'phone'));
        $this->assertSame('Chrome on Linux', OrbitRemoteService::browserLabel('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'computer'));
        $this->assertSame('Phone', OrbitRemoteService::browserLabel('', 'phone'));
        $this->assertTrue(OrbitRemoteService::isPrivateIpv4('192.168.1.20'));
        $this->assertTrue(OrbitRemoteService::isPrivateIpv4('172.20.0.4'));
        $this->assertFalse(OrbitRemoteService::isPrivateIpv4('8.8.8.8'));
        $this->assertFalse(OrbitRemoteService::isPrivateIpv4('127.0.0.1'));
        foreach (app(OrbitRemoteService::class)->lanAddresses() as $ip) {
            $this->assertTrue(OrbitRemoteService::isPrivateIpv4($ip));
        }
    }
}
