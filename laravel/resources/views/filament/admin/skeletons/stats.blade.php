{{-- Placeholder of a stats overview widget while it loads: the stat cards, in the widget's columns. --}}
@php
    use Filament\Support\View\ComponentAttributeBag;

    $labelWidths = ['7rem', '6rem', '8.5rem', '6.5rem'];
    $noteWidths = ['11rem', '9rem', '12.5rem', '8rem'];
@endphp

<div
    role="status"
    aria-busy="true"
    {{ (new ComponentAttributeBag)->gridColumn($columnSpan, $columnStart)->class(['fi-wi-widget', 'da-adm-skel']) }}
>
    <span class="fi-sr-only">{{ $label }}</span>

    <div class="da-adm-stats" style="--da-cols: {{ $columns }}">
        @for ($i = 0; $i < $count; $i++)
            <div class="fi-wi-stats-overview-stat da-adm-stat" style="--skel-delay: {{ $i * 0.06 }}s">
                <span class="da-skel" style="width: {{ $labelWidths[$i % 4] }}; height: .8rem"></span>
                <span class="da-skel da-skel-strong" style="width: {{ $i % 2 ? '4rem' : '5.5rem' }}; height: 1.9rem"></span>
                <span class="da-skel" style="width: {{ $noteWidths[$i % 4] }}; height: .7rem"></span>
                @if ($i % 4 === 0)
                    <span class="da-skel da-skel-accent da-adm-stat-chart"></span>
                @endif
            </div>
        @endfor
    </div>
</div>
