<?php

namespace App\Filament\Resources\OrbitKnowledge\Pages;

use App\Admin\AdminActivity;
use App\Filament\Resources\OrbitKnowledge\OrbitKnowledgeResource;
use Filament\Facades\Filament;
use Filament\Resources\Pages\CreateRecord;

class CreateOrbitKnowledge extends CreateRecord
{
    protected static string $resource = OrbitKnowledgeResource::class;

    protected function mutateFormDataBeforeCreate(array $data): array
    {
        return $data + ['updated_by' => Filament::auth()->id()];
    }

    protected function getCreatedNotificationTitle(): ?string
    {
        return 'Guide saved. Publish to Orbit to make it live.';
    }

    protected function afterCreate(): void
    {
        AdminActivity::record('orbit_knowledge.created', $this->record, ['slug' => $this->record->slug]);
    }

    protected function getRedirectUrl(): string
    {
        return $this->getResource()::getUrl('index');
    }
}
