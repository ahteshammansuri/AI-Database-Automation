{{-- Admin panel brand: the portal's gradient mark, platform name and an "Admin" tag. --}}
<div class="da-brand">
    <span class="da-brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>
        </svg>
    </span>
    <span class="da-brand-text">
        <span class="da-brand-name">{{ config('platform.brand_name', 'Rowpilot') }}</span>
        <span class="da-brand-tag">Admin</span>
    </span>
</div>
