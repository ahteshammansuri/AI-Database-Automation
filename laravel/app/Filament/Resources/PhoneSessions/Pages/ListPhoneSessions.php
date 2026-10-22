<?php

namespace App\Filament\Resources\PhoneSessions\Pages;

use App\Filament\Resources\PhoneSessions\PhoneSessionResource;
use Filament\Resources\Pages\ListRecords;

class ListPhoneSessions extends ListRecords
{
    protected static string $resource = PhoneSessionResource::class;

    public function getSubheading(): ?string
    {
        return 'Phones customers paired with Orbit Remote by QR code.';
    }
}
