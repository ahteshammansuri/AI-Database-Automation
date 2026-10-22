<?php

namespace App\Filament\Resources\CustomerActivity\Pages;

use App\Filament\Resources\CustomerActivity\CustomerActivityResource;
use Filament\Resources\Pages\ListRecords;

class ListCustomerActivity extends ListRecords
{
    protected static string $resource = CustomerActivityResource::class;

    public function getSubheading(): ?string
    {
        return 'The audit trail of every customer account, including what admins did to accounts.';
    }
}
