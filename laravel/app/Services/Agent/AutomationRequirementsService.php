<?php

namespace App\Services\Agent;

use App\Models\DbConnection;
use App\Models\User;
use App\Models\DataConversationState;

class AutomationRequirementsService
{
    /** Fields that must NEVER be silently guessed. */
    public const NEVER_GUESS_FIELDS = [
        'connection',
        'table',
        'schedule',
        'publish_status',
        'approval_required',
        'generate_images',
        'create_related_records',
    ];

    /**
     * Parse natural language automation request into structured requirements card.
     */
    public static function extractRequirements(User $user, string $utterance, ?int $connectionId = null): array
    {
        $u = trim($utterance);
        $uLower = strtolower($u);

        // Fetch user's active connections
        $connections = DbConnection::where('user_id', $user->id)->where('is_active', true)->get();
        $convState = DataConversationState::where('user_id', $user->id)->first();

        // 1. Connection Resolution
        $connField = ['status' => 'missing', 'value' => null, 'label' => 'Target Database Connection'];
        if ($connectionId) {
            $c = $connections->firstWhere('id', $connectionId);
            if ($c) {
                $connField = ['status' => 'provided', 'value' => $c->id, 'display' => $c->name];
            }
        } else {
            // Check if utterance matches any connection
            foreach ($connections as $c) {
                if (str_contains($uLower, strtolower($c->name))) {
                    $connField = ['status' => 'provided', 'value' => $c->id, 'display' => $c->name];
                    break;
                }
            }
            if ($connField['status'] === 'missing' && $convState && $convState->active_connection_id) {
                $c = $connections->firstWhere('id', $convState->active_connection_id);
                if ($c) {
                    $connField = ['status' => 'inferred', 'value' => $c->id, 'display' => $c->name . ' (from active chat context)'];
                }
            }
            if ($connField['status'] === 'missing' && $connections->count() === 1) {
                $c = $connections->first();
                $connField = ['status' => 'inferred', 'value' => $c->id, 'display' => $c->name . ' (only connected database)'];
            }
        }

        // 2. Target Table
        $tableField = ['status' => 'missing', 'value' => null, 'label' => 'Target Content Table'];
        if (preg_match('/(?:into|in|to)\s+(?:the\s+)?([a-zA-Z0-9_]+)\s+table/i', $u, $m)) {
            $tableField = ['status' => 'provided', 'value' => $m[1], 'display' => $m[1]];
        } elseif (preg_match('/(?:post|blog|article|news|faq|product)/i', $uLower, $m)) {
            $cand = match (strtolower($m[0])) {
                'post', 'blog', 'article', 'news' => 'posts',
                'faq' => 'faqs',
                'product' => 'products',
                default => 'posts',
            };
            $tableField = ['status' => 'inferred', 'value' => $cand, 'display' => $cand];
        }

        // 3. Schedule & Timezone
        $tz = $user->timezone ?: 'Asia/Kolkata';
        $schedField = ['status' => 'missing', 'value' => null, 'timezone' => $tz, 'label' => 'Schedule & Timezone'];
        if (preg_match('/every\s+day\s+at\s+(\d+(?::\d+)?\s*(?:am|pm)?)/i', $uLower, $m)) {
            $schedField = [
                'status' => 'provided',
                'value' => 'daily',
                'time' => $m[1],
                'timezone' => $tz,
                'display' => "Daily at {$m[1]} ({$tz})",
            ];
        } elseif (str_contains($uLower, 'weekly')) {
            $schedField = [
                'status' => 'provided',
                'value' => 'weekly',
                'timezone' => $tz,
                'display' => "Weekly ({$tz})",
            ];
        }

        // 4. Publish Status (draft vs live)
        $publishStatusField = ['status' => 'missing', 'value' => null, 'label' => 'Publish Status'];
        if (str_contains($uLower, 'as draft') || str_contains($uLower, 'draft')) {
            $publishStatusField = ['status' => 'provided', 'value' => 'draft', 'display' => 'Draft (saved for manual review)'];
        } elseif (str_contains($uLower, 'publish live') || str_contains($uLower, 'directly live') || str_contains($uLower, 'published')) {
            $publishStatusField = ['status' => 'provided', 'value' => 'published', 'display' => 'Live Published'];
        }

        // 5. Approval Required
        $approvalField = ['status' => 'missing', 'value' => null, 'label' => 'Email Approval Policy'];
        if (str_contains($uLower, 'with approval') || str_contains($uLower, 'require approval') || str_contains($uLower, 'approval email')) {
            $approvalField = ['status' => 'provided', 'value' => true, 'display' => 'Required (email preview sent before publishing)'];
        } elseif (str_contains($uLower, 'no approval') || str_contains($uLower, 'auto publish') || str_contains($uLower, 'without approval')) {
            $approvalField = ['status' => 'provided', 'value' => false, 'display' => 'Auto-publish without email review'];
        }

        // 6. Generate Images
        $imageField = ['status' => 'missing', 'value' => null, 'label' => 'AI Image Generation'];
        if (str_contains($uLower, 'with an image') || str_contains($uLower, 'with image') || str_contains($uLower, 'generate image')) {
            $imageField = ['status' => 'provided', 'value' => true, 'display' => 'Enabled (generates relevant AI image)'];
        } elseif (str_contains($uLower, 'no image') || str_contains($uLower, 'without image')) {
            $imageField = ['status' => 'provided', 'value' => false, 'display' => 'Disabled'];
        }

        // 7. Topic / Content Strategy
        $topicField = ['status' => 'provided', 'value' => $u, 'label' => 'Content Topic / Strategy'];

        $fields = [
            'connection' => $connField,
            'table' => $tableField,
            'schedule' => $schedField,
            'publish_status' => $publishStatusField,
            'approval_required' => $approvalField,
            'generate_images' => $imageField,
            'topic_or_strategy' => $topicField,
        ];

        // Find missing required fields
        $missing = [];
        foreach ($fields as $key => $f) {
            if ($f['status'] === 'missing') {
                $missing[] = $key;
            }
        }

        $readyToCreate = empty($missing);
        $nextQuestion = null;
        $nextOptions = [];

        if (!$readyToCreate) {
            $firstMissing = $missing[0];
            switch ($firstMissing) {
                case 'connection':
                    $nextQuestion = "Which database connection should this automation target?";
                    $nextOptions = $connections->pluck('name')->all();
                    break;
                case 'table':
                    $nextQuestion = "Which table should new content be published to?";
                    $nextOptions = ['posts', 'articles', 'news', 'faqs'];
                    break;
                case 'schedule':
                    $nextQuestion = "What schedule should this automation run on? (e.g., Daily at 9:00 AM in {$tz})";
                    $nextOptions = ['Daily at 9:00 AM', 'Daily at 6:00 PM', 'Weekly on Monday at 10:00 AM', 'Manual only'];
                    break;
                case 'publish_status':
                    $nextQuestion = "Should new records be created as 'draft' or published 'live' immediately?";
                    $nextOptions = ['Save as draft', 'Publish live immediately'];
                    break;
                case 'approval_required':
                    $nextQuestion = "Do you want email approval before publication?";
                    $nextOptions = ['Yes, send email for preview and approval', 'No, publish automatically'];
                    break;
                case 'generate_images':
                    $nextQuestion = "Should AI feature images be generated for each item?";
                    $nextOptions = ['Yes, generate AI images', 'No images needed'];
                    break;
            }
        }

        return [
            'type' => 'requirements_card',
            'fields' => $fields,
            'missing_fields' => $missing,
            'ready_to_create' => $readyToCreate,
            'next_question' => $nextQuestion,
            'next_question_options' => $nextOptions,
        ];
    }
}
