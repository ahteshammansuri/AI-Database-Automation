<?php

namespace App\Filament\Resources\Connections\Pages;

use App\Filament\Resources\Connections\ConnectionResource;
use Filament\Resources\Pages\ListRecords;

class ListConnections extends ListRecords
{
    protected static string $resource = ConnectionResource::class;

    public function getSubheading(): ?string
    {
        return 'Every customer database connection. Credentials are stored encrypted and never shown here.';
    }
}
