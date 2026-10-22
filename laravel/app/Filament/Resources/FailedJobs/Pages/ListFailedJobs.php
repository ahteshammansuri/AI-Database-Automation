<?php

namespace App\Filament\Resources\FailedJobs\Pages;

use App\Filament\Resources\FailedJobs\FailedJobResource;
use Filament\Resources\Pages\ListRecords;

class ListFailedJobs extends ListRecords
{
    protected static string $resource = FailedJobResource::class;

    public function getSubheading(): ?string
    {
        return 'Background jobs that stopped with an error. Only the first line of each error is shown; job data stays private.';
    }
}
