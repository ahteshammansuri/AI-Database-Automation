<?php

namespace App\Filament\Resources\CustomerActivity\Pages;

use App\Admin\AdminActivity;
use App\Admin\AuditDescriber;
use App\Filament\Resources\CustomerActivity\CustomerActivityResource;
use App\Models\AuditLog;
use Filament\Actions\Action;
use Filament\Resources\Pages\ListRecords;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ListCustomerActivity extends ListRecords
{
    protected static string $resource = CustomerActivityResource::class;

    /** Rows one export may contain. */
    private const EXPORT_LIMIT = 20000;

    public function getSubheading(): ?string
    {
        return 'The audit trail of every customer account, including what admins did to accounts. Filter it, open an entry to see what changed, or export what is shown.';
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('export')
                ->label('Export CSV')
                ->icon('heroicon-o-arrow-down-tray')
                ->color('gray')
                ->action(fn () => $this->exportCsv()),
        ];
    }

    /** The entries matching the current filters and search, newest first, as CSV (formula-safe). */
    public function exportCsv(): StreamedResponse
    {
        $query = $this->getFilteredSortedTableQuery()->with('user:id,name,email')->limit(self::EXPORT_LIMIT);
        AdminActivity::record('customer_activity.exported', 'Customer activity log', ['filters' => array_filter((array) $this->tableFilters)], 'CSV export');

        return response()->streamDownload(function () use ($query) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['time_utc', 'customer', 'customer_email', 'what_happened', 'action', 'resource', 'changes', 'details', 'ip_address']);
            foreach ($query->cursor() as $log) {
                /** @var AuditLog $log */
                fputcsv($out, array_map([AuditDescriber::class, 'csvCell'], [
                    $log->created_at?->utc()->toIso8601String(),
                    $log->user?->name,
                    $log->user?->email,
                    AuditDescriber::describe($log),
                    $log->action,
                    trim($log->resource_type . ($log->resource_id ? " #{$log->resource_id}" : '')),
                    implode('; ', AuditDescriber::changes($log)),
                    $log->metadata ? json_encode(collect($log->metadata)->except('changes')->all(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '',
                    $log->ip_address,
                ]));
            }
            fclose($out);
        }, 'customer-activity-' . now()->format('Y-m-d-His') . '.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
