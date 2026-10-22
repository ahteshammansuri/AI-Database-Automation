<?php

namespace App\Filament\Resources\Connections\Pages;

use App\Filament\Resources\Connections\ConnectionResource;
use Filament\Resources\Pages\ViewRecord;

class ViewConnection extends ViewRecord
{
    protected static string $resource = ConnectionResource::class;

    protected function getHeaderActions(): array
    {
        return [ConnectionResource::readOnlyAction()];
    }
}
