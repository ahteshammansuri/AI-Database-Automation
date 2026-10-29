{{-- Placeholder of a table widget while it loads: heading, column headers and rows. --}}
@php
    use Filament\Support\View\ComponentAttributeBag;

    $first = ['9rem', '7rem', '10.5rem', '8rem', '9.5rem', '6.5rem'];
    $second = ['12rem', '10rem', '13rem', '11rem', '9rem', '12.5rem'];
@endphp

<div
    role="status"
    aria-busy="true"
    {{ (new ComponentAttributeBag)->gridColumn($columnSpan, $columnStart)->class(['fi-wi-widget', 'fi-wi-table', 'da-adm-skel']) }}
>
    <span class="fi-sr-only">{{ $label }}</span>

    <div class="fi-ta-ctn da-adm-table">
        <div class="da-adm-table-heading">
            <span class="da-skel da-skel-strong" style="width: 10rem; height: .95rem"></span>
        </div>
        <div class="da-adm-table-row da-adm-table-head" aria-hidden="true">
            <span class="da-skel" style="width: 4.5rem; height: .6rem"></span>
            <span class="da-skel" style="width: 4rem; height: .6rem; margin-inline: auto"></span>
            <span class="da-skel" style="width: 3rem; height: .6rem"></span>
        </div>
        @for ($r = 0; $r < 6; $r++)
            <div class="da-adm-table-row" style="--skel-delay: {{ $r * 0.06 }}s" aria-hidden="true">
                <span class="da-adm-cell-stack">
                    <span class="da-skel da-skel-strong" style="width: {{ $first[$r] }}; height: .75rem"></span>
                    <span class="da-skel" style="width: {{ $second[$r] }}; height: .6rem"></span>
                </span>
                <span class="da-skel" style="width: 1.5rem; height: .7rem; margin-inline: auto"></span>
                <span class="da-skel" style="width: {{ $r % 2 ? '4.5rem' : '5.5rem' }}; height: .7rem"></span>
            </div>
        @endfor
    </div>
</div>
