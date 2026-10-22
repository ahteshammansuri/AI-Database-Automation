<?php

namespace App\Filament\Resources\Runs\Pages;

use App\Filament\Resources\Runs\RunResource;
use Filament\Resources\Pages\ListRecords;

class ListRuns extends ListRecords
{
    protected static string $resource = RunResource::class;

    public function getSubheading(): ?string
    {
        return 'Every automation run across all customers, newest first.';
    }
}
