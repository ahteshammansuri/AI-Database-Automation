<?php

namespace App\Filament\Resources\OrbitKnowledge\Pages;

use App\Filament\Resources\OrbitKnowledge\OrbitKnowledgeResource;
use App\Filament\Resources\OrbitKnowledge\Widgets\OrbitKnowledgeStatus;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListOrbitKnowledge extends ListRecords
{
    protected static string $resource = OrbitKnowledgeResource::class;

    public function getSubheading(): ?string
    {
        return 'What Orbit knows about the website, stored here in the database. Edits stay drafts until you publish them to Orbit. Write {brand} where the product name belongs; it is replaced with the brand name from Settings.';
    }

    protected function getHeaderWidgets(): array
    {
        return [OrbitKnowledgeStatus::class];
    }

    protected function getHeaderActions(): array
    {
        return [
            OrbitKnowledgeResource::publishAction(),
            CreateAction::make()->label('New guide')->color('gray'),
        ];
    }
}
