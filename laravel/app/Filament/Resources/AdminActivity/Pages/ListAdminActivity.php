<?php

namespace App\Filament\Resources\AdminActivity\Pages;

use App\Admin\AdminActivity;
use App\Admin\AuditDescriber;
use App\Filament\Resources\AdminActivity\AdminActivityResource;
use App\Models\AdminActivityLog;
use Filament\Actions\Action;
use Filament\Resources\Pages\ListRecords;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ListAdminActivity extends ListRecords
{
    protected static string $resource = AdminActivityResource::class;

    private const EXPORT_LIMIT = 20000;

    public function getSubheading(): ?string
    {
        return 'Every change made in this panel and by whom, with the value before and after. Secret values are never recorded.';
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
        $query = $this->getFilteredSortedTableQuery()->limit(self::EXPORT_LIMIT);
        AdminActivity::record('admin_activity.exported', 'Admin activity log', ['filters' => array_filter((array) $this->tableFilters)], 'CSV export');

        return response()->streamDownload(function () use ($query) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['time_utc', 'admin', 'action', 'subject', 'changes', 'ip_address']);
            foreach ($query->cursor() as $log) {
                /** @var AdminActivityLog $log */
                $changes = collect(AdminActivityResource::changeLines($log->changes))->map(fn ($line, $field) => "{$field}: {$line}")->implode('; ');
                fputcsv($out, array_map([AuditDescriber::class, 'csvCell'], [
                    $log->created_at?->utc()->toIso8601String(),
                    $log->admin_name,
                    AdminActivityResource::action($log->action),
                    trim(($log->subject_type ? $log->subject_type . ': ' : '') . (string) $log->subject_label),
                    $changes,
                    $log->ip_address,
                ]));
            }
            fclose($out);
        }, 'admin-activity-' . now()->format('Y-m-d-His') . '.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
