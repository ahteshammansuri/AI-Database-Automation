<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Review: {{ $title ?: $automationName }}</title>
<style>
  body { margin:0; padding:0; background:#f1f5f9; }
  .content h1,.content h2,.content h3 { color:#0f172a; line-height:1.3; margin:22px 0 8px; }
  .content h1 { font-size:22px; } .content h2 { font-size:19px; } .content h3 { font-size:16px; }
  .content p { margin:0 0 14px; }
  .content ul,.content ol { margin:0 0 14px; padding-left:22px; }
  .content li { margin:0 0 6px; }
  .content blockquote { margin:0 0 14px; padding:8px 14px; border-left:3px solid #c7d2fe; color:#475569; }
  .content code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:13px; }
  .content a { color:#4f46e5; }
  @media (max-width:640px) { .px { padding-left:18px !important; padding-right:18px !important; } .stack { display:block !important; width:100% !important; } }
</style>
</head>
<body>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

  {{-- Header --}}
  <tr><td class="px" style="padding:22px 32px 18px;border-bottom:1px solid #eef2f7;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#4f46e5;font-weight:700;">Review needed before publishing</p>
    <p style="margin:0;font-size:14px;color:#475569;line-height:1.5;">
      <strong style="color:#0f172a;">{{ $automationName }}</strong> generated version {{ $versionNumber }} for
      <code style="background:#eef2ff;color:#3730a3;padding:1px 6px;border-radius:4px;">{{ $targetTable }}</code>@if($databaseName) in <strong style="color:#0f172a;">{{ $databaseName }}</strong>@endif.
    </p>
  </td></tr>

  {{-- Schedule box --}}
  <tr><td class="px" style="padding:18px 32px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;">
      <tr><td style="padding:14px 16px;font-size:14px;color:#1e1b4b;line-height:1.55;">
        @if($publishAt)
          <strong>Scheduled to publish:</strong> {{ $publishAt }} ({{ $timezone }})<br>
        @endif
        <span style="color:#4338ca;">{{ $policyText }}</span>
      </td></tr>
    </table>
  </td></tr>

  @if($feedback)
  <tr><td class="px" style="padding:12px 32px 0;">
    <p style="margin:0;font-size:13px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;">
      This version was rewritten after feedback: “{{ $feedback }}”
    </p>
  </td></tr>
  @endif

  {{-- Actions --}}
  <tr><td class="px" style="padding:20px 32px 6px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td class="stack" style="padding:0 8px 8px 0;">
        <a href="{{ $reviewUrl }}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;">Review and approve</a>
      </td>
      <td class="stack" style="padding:0 0 8px 0;">
        <a href="{{ $reviewUrl }}#request-changes" style="display:inline-block;background:#ffffff;color:#334155;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;border:1px solid #cbd5e1;">Request changes</a>
      </td>
    </tr></table>
    <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Both open a secure page where you confirm with one click. The link works once and expires {{ $expiresAt }} ({{ $timezone }}).</p>
  </td></tr>

  {{-- Content preview --}}
  <tr><td style="padding:22px 0 0;">
    @if($heroUrl)
      <img src="{{ $heroUrl }}" alt="{{ $title }}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;">
      <p class="px" style="margin:6px 32px 0;font-size:11px;color:#94a3b8;">{{ $heroIsAi ? 'AI-generated image' : 'Designed cover image' }} · stored with this version</p>
    @endif
  </td></tr>
  <tr><td class="px" style="padding:18px 32px 8px;">
    @if($title)
      <h1 style="margin:0 0 10px;font-size:26px;line-height:1.25;color:#0f172a;">{{ $title }}</h1>
    @endif
    @if($summary)
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#475569;">{{ $summary }}</p>
    @endif
    @if(!empty($relations))
      @foreach($relations as $line)
        <p style="margin:0 0 6px;font-size:13px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:6px 10px;">{{ $line }}</p>
      @endforeach
    @endif
    @if($bodyHtml)
      <div class="content" style="margin-top:14px;font-size:15px;line-height:1.7;color:#1e293b;">{!! $bodyHtml !!}</div>
    @endif
  </td></tr>

  @if(!empty($otherImages))
  <tr><td class="px" style="padding:6px 32px 8px;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;">Other images</p>
    @foreach($otherImages as $img)
      <img src="{{ $img['url'] }}" alt="{{ $img['column'] }}" width="180" style="display:inline-block;width:180px;height:auto;border-radius:8px;border:1px solid #e2e8f0;margin:0 8px 8px 0;">
    @endforeach
  </td></tr>
  @endif

  @if(!empty($details))
  <tr><td class="px" style="padding:6px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;">
      @foreach($details as $d)
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;width:38%;">{{ $d['column'] }}</td>
        <td style="padding:8px 12px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;">{{ $d['value'] }}</td>
      </tr>
      @endforeach
    </table>
  </td></tr>
  @endif

  {{-- Write plan --}}
  <tr><td class="px" style="padding:18px 32px 8px;">
    <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0f172a;">What will be written to your database</p>
    <p style="margin:0 0 12px;font-size:13px;color:#64748b;">All steps run in one transaction: if any step fails, nothing is saved.</p>
    @foreach($steps as $i => $step)
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;">
        <tr><td colspan="2" style="padding:10px 12px;background:#f8fafc;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">
          <strong>{{ $i + 1 }}. {{ $step['action'] === 'CREATE_PARENT' ? 'Create' : 'Insert into' }} <code>{{ $step['table'] }}</code></strong>
          <span style="color:#64748b;"> — {{ $step['description'] }}</span>
        </td></tr>
        @foreach($step['rows'] as $row)
        <tr>
          <td style="padding:6px 12px;font-size:12px;color:#64748b;font-family:Menlo,Consolas,monospace;border-bottom:1px solid #f1f5f9;width:34%;vertical-align:top;">{{ $row['column'] }}</td>
          <td style="padding:6px 12px;font-size:12px;color:#0f172a;border-bottom:1px solid #f1f5f9;word-break:break-word;">{{ $row['value'] }}</td>
        </tr>
        @endforeach
      </table>
    @endforeach
  </td></tr>

  @if(!empty($warnings))
  <tr><td class="px" style="padding:4px 32px 8px;">
    @foreach($warnings as $w)
      <p style="margin:0 0 6px;font-size:12px;color:#92400e;">• {{ $w['message'] }}</p>
    @endforeach
  </td></tr>
  @endif

  <tr><td class="px" style="padding:18px 32px 24px;border-top:1px solid #eef2f7;">
    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
      Sent because you are the reviewer for “{{ $automationName }}”.@if($provider) Written with {{ $provider }}@if($model) ({{ $model }})@endif.@endif
      Nothing is published until the scheduled time, and only the exact version shown here can be published from this link.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>
