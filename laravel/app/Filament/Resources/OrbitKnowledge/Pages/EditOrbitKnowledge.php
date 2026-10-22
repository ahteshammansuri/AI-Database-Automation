<?php

namespace App\Filament\Resources\OrbitKnowledge\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitKnowledge\OrbitKnowledgeResource;
use Filament\Actions\DeleteAction;
use Filament\Facades\Filament;
use Filament\Resources\Pages\EditRecord;

class EditOrbitKnowledge extends EditRecord
{
    protected static string $resource = OrbitKnowledgeResource::class;

    private array $attributesBefore = [];

    protected function getHeaderActions(): array
    {
        return [
            OrbitKnowledgeResource::publishAction(),
            DeleteAction::make()
                ->modalDescription('Orbit keeps this guide until you publish again.')
                ->before(fn () => AdminActivity::record('orbit_knowledge.deleted', $this->record)),
        ];
    }

    protected function beforeSave(): void
    {
        $this->attributesBefore = $this->record->getAttributes();
    }

    protected function mutateFormDataBeforeSave(array $data): array
    {
        return ['updated_by' => Filament::auth()->id()] + $data;
    }

    protected function getSavedNotificationTitle(): ?string
    {
        return 'Saved. Not live until you publish to Orbit.';
    }

    protected function afterSave(): void
    {
        $changes = AdminActivity::diff($this->record, $this->attributesBefore);
        unset($changes['updated_by']);
        // The text itself is in the guide; the log records that it changed and by how much.
        if (isset($changes['body'])) {
            $changes['body'] = ['from' => mb_strlen((string) ($this->attributesBefore['body'] ?? '')) . ' characters', 'to' => mb_strlen((string) $this->record->body) . ' characters'];
        }
        if ($changes) {
            AdminActivity::record('orbit_knowledge.updated', $this->record, $changes);
        }
    }
}
