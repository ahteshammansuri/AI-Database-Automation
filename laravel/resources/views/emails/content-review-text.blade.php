REVIEW NEEDED BEFORE PUBLISHING

{{ $automationName }} generated version {{ $versionNumber }} for table "{{ $targetTable }}"@if($databaseName) in {{ $databaseName }}@endif.

@if($publishAt)
Scheduled to publish: {{ $publishAt }} ({{ $timezone }})
@endif
{{ $policyText }}

Review and approve, or request changes:
{{ $reviewUrl }}
(The link works once and expires {{ $expiresAt }}.)

----------------------------------------
@if($title){{ $title }}

@endif
@if($summary){{ $summary }}

@endif
@foreach($relations as $line)
- {{ $line }}
@endforeach

{{ trim(html_entity_decode(strip_tags(str_replace(['</p>', '</li>', '<br>', '</h2>', '</h3>'], "\n", $bodyHtml)))) }}

----------------------------------------
WHAT WILL BE WRITTEN (one transaction)
@foreach($steps as $i => $step)
{{ $i + 1 }}. {{ $step['action'] === 'CREATE_PARENT' ? 'Create in' : 'Insert into' }} {{ $step['table'] }}
@foreach($step['rows'] as $row)
   {{ $row['column'] }}: {{ $row['value'] }}
@endforeach
@endforeach
