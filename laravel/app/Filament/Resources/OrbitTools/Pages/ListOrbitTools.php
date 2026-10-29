<?php

namespace App\Filament\Resources\OrbitTools\Pages;

use App\Filament\Resources\OrbitTools\OrbitToolResource;
use Filament\Resources\Pages\ListRecords;

class ListOrbitTools extends ListRecords
{
    protected static string $resource = OrbitToolResource::class;

    public function getSubheading(): ?string
    {
        return 'All capabilities, tools, and actions Orbit can execute. Enable or disable capabilities, adjust risk tiers, or modify model instructions dynamically.';
    }
}
