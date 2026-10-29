{{-- Placeholder of a chart widget while it loads: its real heading, then bars or a line in the chart's height. --}}
@php
    use Filament\Support\View\ComponentAttributeBag;

    $bars = [38, 62, 30, 78, 52, 66, 44, 84, 58, 36, 70, 48, 74, 56];
@endphp

<div
    role="status"
    aria-busy="true"
    {{ (new ComponentAttributeBag)->gridColumn($columnSpan, $columnStart)->class(['fi-wi-widget', 'fi-wi-chart', 'da-adm-skel']) }}
>
    <span class="fi-sr-only">{{ $label }}</span>

    <section class="fi-section fi-section-has-header">
        <header class="fi-section-header">
            <div class="fi-section-header-content fi-section-header-content-has-heading">
                <div class="fi-section-header-text-ctn">
                    @if (filled($heading))
                        <h3 class="fi-section-header-heading">{{ $heading }}</h3>
                    @else
                        <span class="da-skel" style="width: 9rem; height: .9rem"></span>
                    @endif
                    @if (filled($description))
                        <p class="fi-section-header-description">{{ $description }}</p>
                    @endif
                </div>
            </div>
        </header>

        <div class="fi-section-content-ctn">
            <div class="fi-section-content">
                <div class="da-adm-chart" style="height: {{ $height }}">
                    <div class="da-adm-chart-grid" aria-hidden="true">
                        @for ($g = 0; $g < 4; $g++)
                            <span></span>
                        @endfor
                    </div>

                    @if ($type === 'bar')
                        <div class="da-adm-bars">
                            @foreach ($bars as $i => $h)
                                <span class="da-skel da-skel-accent" style="height: {{ $h }}%; --skel-delay: {{ $i * 0.05 }}s"></span>
                            @endforeach
                        </div>
                    @else
                        <svg class="da-adm-line" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
                            <path class="da-adm-line-area" d="M0,78 C25,70 40,52 65,58 C90,64 105,34 130,38 C155,42 170,62 195,50 C220,38 240,22 265,30 C280,34 290,26 300,22 L300,100 L0,100 Z" />
                            <path class="da-adm-line-stroke" d="M0,78 C25,70 40,52 65,58 C90,64 105,34 130,38 C155,42 170,62 195,50 C220,38 240,22 265,30 C280,34 290,26 300,22" />
                        </svg>
                    @endif
                </div>

                <div class="da-adm-axis" aria-hidden="true">
                    @for ($x = 0; $x < 7; $x++)
                        <span class="da-skel" style="width: 2.25rem; height: .55rem"></span>
                    @endfor
                </div>
            </div>
        </div>
    </section>
</div>
