<?php

namespace App\Filament\Resources\PhoneSessions\Pages;

use App\Filament\Resources\PhoneSessions\PhoneSessionResource;
use Filament\Resources\Pages\ViewRecord;

class ViewPhoneSession extends ViewRecord
{
    protected static string $resource = PhoneSessionResource::class;

    public function getTitle(): string
    {
        return 'Phone session #' . $this->record->getKey();
    }
}
