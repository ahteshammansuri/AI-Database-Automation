<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\DbConnection;
use App\Models\User;
use Exception;

class TemplateService
{
    public function __construct(
        protected FeatureFlagService $featureFlagService
    ) {}

    protected const TEMPLATES = [
        [
            'id' => 'tech_blog',
            'name' => 'Tech Blog Publication',
            'category' => 'Content & Marketing',
            'description' => 'Automated publication of technical articles, deep dives, and tutorials with Markdown formatting, SEO slugs, and excerpt generation.',
            'target_table' => 'posts',
            'schedule_type' => 'daily',
            'lead_time_minutes' => 30,
            'topic_prompt' => 'Produce an engaging technical deep-dive on distributed database architecture, highlighting ACID guarantees and failure recovery.',
            'default_fields' => ['title', 'slug', 'content', 'excerpt', 'status', 'published_at'],
            'safe_deadline_policy' => 'publish_last_valid',
        ],
        [
            'id' => 'product_showcase',
            'name' => 'E-Commerce Product Showcase',
            'category' => 'E-Commerce & Retail',
            'description' => 'Generates product copy, technical specifications, value propositions, and SEO meta descriptions for retail catalogs.',
            'target_table' => 'products',
            'schedule_type' => 'weekly',
            'lead_time_minutes' => 60,
            'topic_prompt' => 'Create compelling product descriptions emphasizing durability, sustainable materials, and ergonomics for new inventory items.',
            'default_fields' => ['name', 'slug', 'description', 'price', 'in_stock'],
            'safe_deadline_policy' => 'skip',
        ],
        [
            'id' => 'customer_faq',
            'name' => 'Knowledge Base & Customer FAQ',
            'category' => 'Support & Documentation',
            'description' => 'Continuously refreshes FAQ entries, troubleshooting steps, and help desk solutions based on user inquiries.',
            'target_table' => 'faqs',
            'schedule_type' => 'daily',
            'lead_time_minutes' => 30,
            'topic_prompt' => 'Formulate a helpful customer FAQ entry clarifying account security, password reset mechanisms, and session management.',
            'default_fields' => ['question', 'answer', 'category_id', 'is_published'],
            'safe_deadline_policy' => 'notify_and_wait',
        ],
        [
            'id' => 'release_notes',
            'name' => 'Software Changelog & Release Notes',
            'category' => 'Engineering & DevOps',
            'description' => 'Generates polished release notes, breaking change warnings, and developer changelogs.',
            'target_table' => 'changelogs',
            'schedule_type' => 'weekly',
            'lead_time_minutes' => 45,
            'topic_prompt' => 'Draft version 2.4 release notes highlighting performance optimizations, query latency reductions, and bug fixes.',
            'default_fields' => ['version', 'release_date', 'summary', 'highlights'],
            'safe_deadline_policy' => 'publish_last_valid',
        ],
    ];

    /**
     * List all available automation templates.
     */
    public function listTemplates(): array
    {
        if (!$this->featureFlagService->isEnabled('FEATURE_TEMPLATES')) {
            return [];
        }

        return self::TEMPLATES;
    }

    /**
     * Create an automation from a predefined template.
     */
    public function createFromTemplate(User $user, string $templateId, int $connectionId, array $overrides = []): Automation
    {
        if (!$this->featureFlagService->isEnabled('FEATURE_TEMPLATES')) {
            throw new Exception("Templates feature is disabled by platform feature flag.");
        }

        $template = collect(self::TEMPLATES)->firstWhere('id', $templateId);
        if (!$template) {
            throw new Exception("Template '{$templateId}' does not exist.");
        }

        $connection = DbConnection::where('id', $connectionId)
            ->where('user_id', $user->id)
            ->first();

        if (!$connection) {
            throw new Exception("Database connection #{$connectionId} not found or unauthorized.");
        }

        $pubTime = \Carbon\Carbon::createFromFormat('H:i', '09:00');
        $leadMinutes = (int) ($template['lead_time_minutes'] ?? 30);
        $genTime = $pubTime->copy()->subMinutes($leadMinutes)->format('H:i');

        $automation = Automation::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'name' => $overrides['name'] ?? "{$template['name']} ({$connection->name})",
            'target_table' => $overrides['target_table'] ?? $template['target_table'],
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => $overrides['field_mappings'] ?? ['fields' => $template['default_fields']],
            'schedule_type' => strtoupper($overrides['schedule_type'] ?? $template['schedule_type']),
            'generation_time' => $genTime,
            'publication_time' => '09:00',
            'timezone' => $overrides['timezone'] ?? 'UTC',
            'is_active' => true,
            'requires_approval' => $overrides['requires_approval'] ?? true,
            'safe_deadline_policy' => $template['safe_deadline_policy'],
            'prompt_context' => $overrides['topic_prompt'] ?? $template['topic_prompt'],
        ]);

        return $automation;
    }
}
