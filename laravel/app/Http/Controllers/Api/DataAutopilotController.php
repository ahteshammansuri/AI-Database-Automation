<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\RunDataAutopilotJob;
use App\Models\AuditLog;
use App\Models\DataAutopilot;
use App\Models\DbConnection;
use App\Services\Data\DataException;
use App\Services\Data\SampleDataService;
use App\Services\FeatureFlagService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Data autopilots of the signed-in customer: scheduled AI sample rows for one table each. */
class DataAutopilotController extends Controller
{
    private function enabled(): void
    {
        $flags = app(FeatureFlagService::class);
        abort_unless($flags->isEnabled('FEATURE_DATA_AUTOPILOT') && $flags->isEnabled('FEATURE_DATA_MANAGER'), 403, 'Data autopilot is turned off by the administrator.');
    }

    private function present(DataAutopilot $p): array
    {
        return $p->only(['id', 'connection_id', 'table_name', 'name', 'rows_per_run', 'instructions', 'frequency', 'every_hours', 'run_time', 'weekdays', 'timezone', 'is_active', 'last_status', 'last_message', 'last_change_id', 'runs_count', 'rows_added'])
            + [
                'schedule' => $p->describeSchedule(),
                'ends_on' => $p->ends_on?->toDateString(),
                'next_run_at' => $p->next_run_at?->toIso8601String(),
                'last_run_at' => $p->last_run_at?->toIso8601String(),
            ];
    }

    public function index(Request $request): JsonResponse
    {
        $q = DataAutopilot::where('user_id', $request->user()->id)->latest('id');
        if ($request->filled('connection_id')) {
            $q->where('connection_id', (int) $request->query('connection_id'));
        }
        if ($request->filled('table')) {
            $q->where('table_name', (string) $request->query('table'));
        }
        return response()->json(['autopilots' => $q->get()->map(fn ($p) => $this->present($p))->values()]);
    }

    private function rules(Request $request): array
    {
        return $request->validate([
            'connection_id' => 'required|integer',
            'table_name' => 'required|string|max:64|regex:/^[A-Za-z0-9_$\\-]+$/',
            'name' => 'required|string|max:120',
            'rows_per_run' => 'required|integer|min:1|max:' . SampleDataService::maxRows(),
            'instructions' => 'nullable|string|max:1000',
            'frequency' => ['required', Rule::in(DataAutopilot::FREQUENCIES)],
            'every_hours' => 'required_if:frequency,hourly|nullable|integer|min:1|max:24',
            'run_time' => ['required_unless:frequency,hourly', 'nullable', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'weekdays' => 'required_if:frequency,weekly|nullable|array|min:1|max:7',
            'weekdays.*' => 'integer|min:1|max:7',
            'timezone' => ['required', 'string', Rule::in(timezone_identifiers_list())],
            'ends_on' => 'nullable|date|after_or_equal:today',
            'is_active' => 'nullable|boolean',
        ], [
            'run_time.regex' => 'Use a time like 09:30.',
            'timezone.in' => 'Choose a valid timezone.',
            'weekdays.required_if' => 'Choose at least one day.',
        ]);
    }

    public function store(Request $request, SampleDataService $samples): JsonResponse
    {
        $this->enabled();
        $v = $this->rules($request);
        $user = $request->user();
        $connection = DbConnection::where('user_id', $user->id)->findOrFail($v['connection_id']);

        $limit = (int) config('data_explorer.max_autopilots_per_customer', 10);
        if ($limit > 0 && DataAutopilot::where('user_id', $user->id)->count() >= $limit) {
            $msg = "You can have at most {$limit} data autopilots.";
            return response()->json(['message' => $msg, 'errors' => ['name' => [$msg]]], 422);
        }
        // The table must accept sample rows now (writable, links possible); otherwise say why before saving.
        try {
            $rules = $samples->columnRules($connection, $v['table_name']);
        } catch (DataException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['table_name' => [$e->getMessage()]]], 422);
        }
        if ($rules['blockers']) {
            $msg = implode(' ', $rules['blockers']);
            return response()->json(['message' => $msg, 'errors' => ['table_name' => [$msg]]], 422);
        }

        $pilot = new DataAutopilot($v + ['user_id' => $user->id, 'every_hours' => $v['every_hours'] ?? 1, 'run_time' => $v['run_time'] ?? '09:00', 'is_active' => $v['is_active'] ?? true]);
        $pilot->next_run_at = $pilot->is_active ? $pilot->nextRunAfter() : null;
        $pilot->save();
        AuditLog::log($user->id, 'DATA_AUTOPILOT_CREATED', 'DataAutopilot', (string) $pilot->id, ['table' => $pilot->table_name, 'rows_per_run' => $pilot->rows_per_run, 'schedule' => $pilot->describeSchedule()]);

        return response()->json(['autopilot' => $this->present($pilot)], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->enabled();
        $pilot = DataAutopilot::where('user_id', $request->user()->id)->findOrFail($id);
        if (array_keys($request->all()) === ['is_active']) {
            $active = $request->boolean('is_active');
            $pilot->update(['is_active' => $active, 'failures_in_a_row' => 0, 'next_run_at' => $active ? $pilot->nextRunAfter() : null]);
        } else {
            $v = $this->rules($request);
            abort_unless((int) $v['connection_id'] === (int) $pilot->connection_id && $v['table_name'] === $pilot->table_name, 422, 'Create a new autopilot to use another table.');
            $pilot->fill($v);
            $pilot->next_run_at = $pilot->is_active ? $pilot->nextRunAfter() : null;
            $pilot->save();
        }
        AuditLog::log($request->user()->id, $pilot->is_active ? 'DATA_AUTOPILOT_UPDATED' : 'DATA_AUTOPILOT_PAUSED', 'DataAutopilot', (string) $pilot->id, ['schedule' => $pilot->describeSchedule()]);
        return response()->json(['autopilot' => $this->present($pilot->fresh())]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $pilot = DataAutopilot::where('user_id', $request->user()->id)->findOrFail($id);
        AuditLog::log($request->user()->id, 'DATA_AUTOPILOT_DELETED', 'DataAutopilot', (string) $pilot->id, ['table' => $pilot->table_name]);
        $pilot->delete();
        return response()->json(['deleted' => true]);
    }

    /** Queue one run now (the schedule is unchanged). */
    public function runNow(Request $request, int $id): JsonResponse
    {
        $this->enabled();
        $pilot = DataAutopilot::where('user_id', $request->user()->id)->findOrFail($id);
        RunDataAutopilotJob::dispatch($pilot->id);
        return response()->json(['queued' => true, 'message' => 'Queued: the rows are added in the background; the result appears here.']);
    }
}
