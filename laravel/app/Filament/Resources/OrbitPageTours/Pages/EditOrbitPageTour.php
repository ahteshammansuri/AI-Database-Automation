<?php

namespace App\Filament\Resources\OrbitPageTours\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitPageTours\OrbitPageTourResource;
use Filament\Actions\DeleteAction;
use Filament\Facades\Filament;
use Filament\Resources\Pages\EditRecord;

class EditOrbitPageTour extends EditRecord
{
    protected static string $resource = OrbitPageTourResource::class;

    private array $attributesBefore = [];

    protected function getHeaderActions(): array
    {
        return [
            DeleteAction::make()
                ->modalDescription('Orbit stops explaining this page in tours.')
                ->before(fn () => AdminActivity::record('orbit_page_tour.deleted', $this->record, ['route' => $this->record->route])),
        ];
    }

    protected function beforeSave(): void
    {
        $this->attributesBefore = $this->record->getAttributes();
    }

    protected function mutateFormDataBeforeSave(array $data): array
    {
        OrbitPageTourResource::assertStepsRun($data);

        return ['updated_by' => Filament::auth()->id(), 'steps' => array_values((array) ($data['steps'] ?? []))] + $data;
    }

    protected function afterSave(): void
    {
        $changes = AdminActivity::diff($this->record, $this->attributesBefore);
        unset($changes['updated_by']);
        // The steps themselves are in the tour; the log records that they changed and how many there are.
        if (isset($changes['steps'])) {
            $before = json_decode((string) ($this->attributesBefore['steps'] ?? '[]'), true);
            $changes['steps'] = ['from' => count((array) $before) . ' steps', 'to' => count((array) $this->record->steps) . ' steps'];
        }
        if ($changes) {
            AdminActivity::record('orbit_page_tour.updated', $this->record, $changes);
        }
    }
}
