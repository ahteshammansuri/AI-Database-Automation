<?php

namespace App\Mail;

use App\Models\ApprovalToken;
use App\Models\ContentVersion;
use App\Services\Automation\ScheduleCalculator;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

/**
 * Review email for one immutable content version: the rendered content, the exact database
 * write plan, when it will publish (in the automation's timezone) and what happens without a
 * decision. Actions link to the token-protected review page, which requires a click (POST) to
 * approve or reject, so mail scanners following links cannot publish anything.
 */
class ContentReviewMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public ContentVersion $version,
        public ApprovalToken $token,
        public string $reviewUrl,
    ) {}

    public function envelope(): Envelope
    {
        $automation = $this->version->execution->automation;
        $title = $this->presentation()['title'];
        return new Envelope(
            subject: "Review before publishing: " . Str::limit($title ?: $automation->name, 70) . " (v{$this->version->version_number})",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.content-review',
            text: 'emails.content-review-text',
            with: $this->presentation(),
        );
    }

    /** Everything the templates render, computed once from the version and its metadata. */
    public function presentation(): array
    {
        $version = $this->version;
        $execution = $version->execution;
        $automation = $execution->automation;
        $payload = is_array($version->payload) ? $version->payload : [];
        $meta = is_array($version->meta) ? $version->meta : [];
        $tz = ScheduleCalculator::normalizeTimezone($automation->timezone);

        $kinds = [];
        foreach ($meta['fields'] ?? [] as $f) {
            $kinds[$f['column']] = $f['kind'];
        }
        $pick = function (array $wanted) use ($kinds, $payload) {
            foreach ($kinds as $col => $kind) {
                if (in_array($kind, $wanted, true) && !empty($payload[$col]) && is_string($payload[$col])) {
                    return $col;
                }
            }
            return null;
        };

        $titleCol = $pick(['title']) ?? (isset($payload['title']) ? 'title' : (isset($payload['name']) ? 'name' : null));
        $summaryCol = $pick(['summary', 'meta_description']);
        $bodyCol = $pick(['body']);

        $body = $bodyCol ? (string) $payload[$bodyCol] : '';
        $isHtml = ($meta['content_format'] ?? 'markdown') === 'html' || preg_match('/<\/(p|h[1-6]|ul|ol|div)>/i', $body);
        $bodyHtml = $isHtml
            ? strip_tags($body, '<p><br><h1><h2><h3><h4><ul><ol><li><strong><em><b><i><blockquote><code><pre><a>')
            : Str::markdown($body, ['html_input' => 'strip', 'allow_unsafe_links' => false]);

        $media = $meta['media'] ?? [];
        $hero = collect($media)->firstWhere('role', 'banner') ?? ($media[0] ?? null);

        $pubAt = $execution->publication_time ? CarbonImmutable::instance($execution->publication_time)->setTimezone($tz) : null;
        $policy = match ($automation->timeout_policy) {
            'AUTO_PUBLISH_LATEST' => 'If nobody approves or rejects it by then, this version will be published automatically.',
            'CANCEL' => 'If nobody approves it by then, the run is cancelled and nothing is written.',
            default => 'If nobody approves it by then, nothing is published; the draft is kept.',
        };

        $runtimeNow = $meta['runtime_now'] ?? [];
        $steps = [];
        foreach ($meta['write_plan']['steps'] ?? [] as $step) {
            $rows = [];
            $isMain = ($step['action'] ?? '') === 'INSERT';
            foreach ($step['values'] ?? [] as $col => $val) {
                $display = is_scalar($val) || $val === null ? (string) ($val ?? 'NULL') : json_encode($val);
                if ($isMain && in_array($col, $runtimeNow, true)) {
                    $display = 'the moment it is published';
                } elseif (($kinds[$col] ?? null) === 'body') {
                    $display = Str::limit(trim(preg_replace('/\s+/', ' ', strip_tags($display))), 140);
                } elseif (($kinds[$col] ?? null) === 'image') {
                    $display = 'image: ' . Str::limit($display, 90);
                } else {
                    $display = Str::limit($display, 140);
                }
                $rows[] = ['column' => $col, 'value' => $display];
            }
            $steps[] = [
                'action' => $step['action'],
                'table' => $step['table'],
                'description' => $step['description'] ?? '',
                'rows' => $rows,
            ];
        }

        $details = [];
        foreach ($payload as $col => $val) {
            if (in_array($col, [$titleCol, $summaryCol, $bodyCol], true) || ($kinds[$col] ?? null) === 'image' || !is_scalar($val)) {
                continue;
            }
            if (!array_key_exists($col, $kinds) && !isset($meta['write_plan']['row'][$col])) {
                continue;
            }
            $details[] = ['column' => Str::headline($col), 'value' => in_array($col, $runtimeNow, true) ? 'Set when published' : Str::limit((string) $val, 120)];
        }

        $relations = [];
        foreach ($meta['relations'] ?? [] as $rel) {
            $relations[] = match ($rel['decision'] ?? '') {
                'create' => "New {$rel['entity']} \"{$rel['label']}\" will be created in `{$rel['table']}` and linked.",
                'reuse' => "Linked to the existing {$rel['entity']} \"{$rel['label']}\".",
                default => "Linked to {$rel['entity']} {$rel['label']}.",
            };
        }

        return [
            'automationName' => $automation->name,
            'targetTable' => $automation->target_table,
            'databaseName' => $automation->connection?->database_name,
            'versionNumber' => $version->version_number,
            'feedback' => $version->rejection_feedback,
            'title' => $titleCol ? (string) $payload[$titleCol] : null,
            'summary' => $summaryCol ? (string) $payload[$summaryCol] : null,
            'bodyHtml' => $bodyHtml,
            'heroUrl' => $hero['url'] ?? null,
            'heroIsAi' => (bool) ($hero['is_ai_generated'] ?? false),
            'otherImages' => array_values(array_filter($media, fn($m) => $m !== $hero)),
            'details' => $details,
            'relations' => $relations,
            'steps' => $steps,
            'warnings' => array_values(array_filter($meta['issues'] ?? [], fn($i) => ($i['level'] ?? '') === 'warning')),
            'publishAt' => $pubAt ? $pubAt->format('l, j F Y \a\t H:i') : null,
            'timezone' => $tz,
            'policyText' => $policy,
            'reviewUrl' => $this->reviewUrl,
            'expiresAt' => CarbonImmutable::instance($this->token->expires_at)->setTimezone($tz)->format('j M Y, H:i'),
            'provider' => $meta['provider'] ?? null,
            'model' => $meta['model'] ?? null,
        ];
    }
}
