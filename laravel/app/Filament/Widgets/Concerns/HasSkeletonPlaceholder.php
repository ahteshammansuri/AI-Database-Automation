<?php

namespace App\Filament\Widgets\Concerns;

use Filament\Widgets\ChartWidget;
use Filament\Widgets\StatsOverviewWidget;
use Illuminate\Contracts\View\View;
use ReflectionMethod;

/**
 * While a lazy dashboard widget loads, show a skeleton in its own shape (stat cards, a chart under its real
 * heading, or a table) instead of Filament's empty pulsing box. Styled for the light and dark admin themes in
 * resources/views/filament/admin/theme.blade.php. Reads nothing from the database.
 */
trait HasSkeletonPlaceholder
{
    public function placeholder(): View
    {
        $data = [
            ...$this->getPlaceholderData(),
            'label' => __('filament::components/loading-section.label'),
        ];

        if ($this instanceof StatsOverviewWidget) {
            // Filament's own getColumns() counts the stats, which would run their queries: only ask a widget that
            // sets its columns itself.
            $declared = (new ReflectionMethod($this, 'getColumns'))->getDeclaringClass()->getName() !== StatsOverviewWidget::class;
            $columns = $declared || $this->columns ? $this->getColumns() : 4;
            $columns = is_int($columns) ? $columns : 4;

            return view('filament.admin.skeletons.stats', [...$data, 'columns' => $columns, 'count' => $columns * 2]);
        }

        if ($this instanceof ChartWidget) {
            return view('filament.admin.skeletons.chart', [
                ...$data,
                'heading' => $this->getHeading(),
                'description' => $this->getDescription(),
                'type' => $this->getType(),
                'height' => $this->getMaxHeight() ?? '260px',
            ]);
        }

        return view('filament.admin.skeletons.table', $data);
    }
}
