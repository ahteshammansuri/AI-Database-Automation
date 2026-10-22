<?php

namespace App\Filament\Resources\AdminActivity\Pages;

use App\Filament\Resources\AdminActivity\AdminActivityResource;
use Filament\Resources\Pages\ListRecords;

class ListAdminActivity extends ListRecords
{
    protected static string $resource = AdminActivityResource::class;

    public function getSubheading(): ?string
    {
        return 'Every change made in this panel and by whom. Secret values are never recorded.';
    }
}
