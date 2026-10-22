<?php

namespace App\Filament\Resources\Roles\Schemas;

use App\Admin\AdminPermissions;
use App\Models\Admin;
use Filament\Forms\Components\CheckboxList;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Components\Grid;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Illuminate\Validation\Rules\Unique;

class RoleForm
{
    public static function configure(Schema $schema): Schema
    {
        $areas = [];
        foreach (AdminPermissions::AREAS as $area => [$label, $description, $abilities]) {
            $options = [];
            foreach ($abilities as $ability => $text) {
                $options["{$area}.{$ability}"] = $text;
            }
            $areas[] = Section::make($label)
                ->description($description)
                ->compact()
                ->components([
                    CheckboxList::make("permission_areas.{$area}")
                        ->hiddenLabel()
                        ->options($options)
                        ->bulkToggleable(count($options) > 1),
                ]);
        }

        return $schema
            ->columns(1)
            ->components([
                Section::make('Role')
                    ->components([
                        TextInput::make('name')
                            ->required()
                            ->maxLength(60)
                            ->regex('/^[a-z][a-z0-9_]*$/')
                            ->validationMessages(['regex' => 'Use lowercase letters, numbers and _ (for example: support_lead).'])
                            ->notIn([Admin::SUPER_ADMIN])
                            ->unique(ignoreRecord: true, modifyRuleUsing: fn (Unique $rule) => $rule->where('guard_name', 'admin'))
                            ->helperText('Shown as words in the panel: support_lead becomes "Support Lead".'),
                    ]),
                Section::make('Permissions')
                    ->description('Viewing is separate from changing. A role sees only the areas it can view.')
                    ->components([
                        Grid::make(['default' => 1, 'lg' => 2])->components($areas),
                    ]),
            ]);
    }
}
