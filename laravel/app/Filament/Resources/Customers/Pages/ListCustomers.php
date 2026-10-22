<?php

namespace App\Filament\Resources\Customers\Pages;

use App\Filament\Resources\Customers\CustomerResource;
use Filament\Resources\Pages\ListRecords;

class ListCustomers extends ListRecords
{
    protected static string $resource = CustomerResource::class;

    public function getSubheading(): ?string
    {
        return 'Everyone who signed up, with their usage. Passwords, database credentials and API keys are never shown.';
    }
}
