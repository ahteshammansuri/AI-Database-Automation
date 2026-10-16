<?php

namespace App\Services\Automation;

use App\Models\AiProvider;
use App\Models\Automation;
use App\Services\AiServiceClient;
use App\Services\MediaService;
use Illuminate\Support\Str;

/**
 * Generates the image for an image column (banner, cover, thumbnail, social/meta image ...) from
 * the content that was just written, stores it as a MediaAsset and returns the value to put in the
 * column (public URL, or storage path for *_path columns).
 *
 * Provider choice (generation_options.image_provider):
 *   auto   -> OpenAI if the user saved an OpenAI key, else Gemini if they saved a Gemini key,
 *             else the local designed cover;
 *   openai | gemini | local -> exactly that provider.
 * A failing paid provider falls back to the local designed cover, and the fallback is recorded.
 */
class ImageFieldService
{
    public const PROVIDERS = ['auto', 'openai', 'gemini', 'local'];

    public function __construct(
        protected AiServiceClient $ai,
        protected MediaService $media,
    ) {}

    /** Role and pixel size for a column, from its name. */
    public static function roleFor(string $column): array
    {
        $n = strtolower($column);
        if (preg_match('/(og_|social|share|meta_img|meta_image|seo_image|twitter)/', $n)) {
            return ['role' => 'social', 'width' => 1200, 'height' => 630, 'label' => 'social sharing card'];
        }
        if (preg_match('/(thumb|avatar|icon|square|logo)/', $n)) {
            return ['role' => 'square', 'width' => 800, 'height' => 800, 'label' => 'square thumbnail'];
        }
        return ['role' => 'banner', 'width' => 1600, 'height' => 900, 'label' => 'wide header banner'];
    }

    /**
     * Which provider an automation would use right now, and why (for the UI and the run log).
     *
     * @return array{provider: string, model: ?string, api_key: ?string, reason: string}
     */
    public function resolveProvider(Automation $automation): array
    {
        $choice = strtolower((string) $automation->generationOption('image_provider', 'auto'));
        $model = $automation->generationOption('image_model');

        $keys = AiProvider::where('user_id', $automation->user_id)
            ->whereIn('provider_type', ['openai', 'gemini'])
            ->get()
            ->filter(fn($p) => !empty($p->encrypted_api_key))
            ->keyBy('provider_type');

        if (in_array($choice, ['openai', 'gemini'], true)) {
            if ($keys->has($choice)) {
                return ['provider' => $choice, 'model' => $model, 'api_key' => $keys[$choice]->encrypted_api_key, 'reason' => 'Selected in this automation.'];
            }
            return ['provider' => 'local', 'model' => null, 'api_key' => null, 'reason' => ucfirst($choice) . ' was selected but no API key is saved; using the local designed cover.'];
        }
        if ($choice === 'local') {
            return ['provider' => 'local', 'model' => null, 'api_key' => null, 'reason' => 'Local designed cover selected.'];
        }
        foreach (['openai', 'gemini'] as $p) {
            if ($keys->has($p)) {
                return ['provider' => $p, 'model' => $model, 'api_key' => $keys[$p]->encrypted_api_key, 'reason' => 'Using your ' . ($p === 'openai' ? 'OpenAI' : 'Gemini') . ' key.'];
            }
        }
        return ['provider' => 'local', 'model' => null, 'api_key' => null, 'reason' => 'No OpenAI or Gemini key saved, so a designed cover is created locally (free). Add a key on the AI Providers page for AI-painted images.'];
    }

    /**
     * @param array $context title, summary, category, topic, entity
     * @return array{value: string, meta: array}
     */
    public function generate(Automation $automation, string $column, array $columnMeta, array $context, ?callable $log = null): array
    {
        $role = self::roleFor($column);
        $provider = $this->resolveProvider($automation);
        $prompt = $this->buildPrompt($automation, $role, $context);
        $title = $context['title'] ?? $automation->name;
        $label = $context['category'] ?? Str::headline(Str::singular(str_replace('_', ' ', $automation->target_table)));

        $fallbackReason = null;
        try {
            $res = $this->ai->generateImage([
                'provider' => $provider['provider'],
                'api_key' => $provider['api_key'],
                'model' => $provider['model'],
                'prompt' => $prompt,
                'width' => $role['width'],
                'height' => $role['height'],
                'title' => $title,
                'label' => $label,
                'seed' => ($context['topic'] ?? '') . '|' . $title,
            ]);
        } catch (\Throwable $e) {
            if ($provider['provider'] === 'local') {
                throw new \Exception("Image for `{$column}` could not be created: " . $e->getMessage());
            }
            $fallbackReason = ucfirst($provider['provider']) . ' image failed (' . Str::limit($e->getMessage(), 160) . '); used the local designed cover instead.';
            $log && $log('IMAGE_PROVIDER_FALLBACK', $fallbackReason, ['column' => $column]);
            $res = $this->ai->generateImage([
                'provider' => 'local',
                'prompt' => $prompt,
                'width' => $role['width'],
                'height' => $role['height'],
                'title' => $title,
                'label' => $label,
                'seed' => ($context['topic'] ?? '') . '|' . $title,
            ]);
        }

        $asset = $this->media->importMedia($automation->user_id, 'data:' . ($res['mime_type'] ?? 'image/png') . ';base64,' . $res['image_base64']);
        $this->media->commitStagedFiles();

        $usePath = (bool) preg_match('/_path$/', strtolower($column));
        $value = $usePath ? $asset->path : $asset->url;
        if (!empty($columnMeta['max_length']) && mb_strlen($value) > $columnMeta['max_length']) {
            $value = $asset->path; // URL does not fit; the relative path always does for sane columns
        }

        $meta = [
            'column' => $column,
            'role' => $role['role'],
            'url' => $asset->url,
            'stored_value' => $value,
            'asset_id' => $asset->id,
            'provider' => $res['provider_used'] ?? $provider['provider'],
            'model' => $res['model_used'] ?? null,
            'width' => $res['width'] ?? $role['width'],
            'height' => $res['height'] ?? $role['height'],
            'mime_type' => $asset->mime_type,
            'prompt' => $prompt,
            'alt' => Str::limit($title, 120, ''),
            'is_ai_generated' => in_array($res['provider_used'] ?? '', ['openai', 'gemini'], true),
            'fallback_reason' => $fallbackReason,
            'provider_reason' => $provider['reason'],
        ];

        $log && $log('IMAGE_GENERATED', ($meta['is_ai_generated'] ? 'AI image' : 'Designed cover') . " created for `{$column}` ({$meta['width']}x{$meta['height']}, {$meta['provider']}).", [
            'column' => $column,
            'provider' => $meta['provider'],
            'model' => $meta['model'],
            'url' => $meta['url'],
        ]);

        return ['value' => $value, 'meta' => $meta];
    }

    private function buildPrompt(Automation $automation, array $role, array $context): string
    {
        $entity = $context['entity'] ?? Str::singular(str_replace('_', ' ', $automation->target_table));
        $title = $context['title'] ?? $automation->name;
        $summary = trim(strip_tags((string) ($context['summary'] ?? '')));
        $category = $context['category'] ?? null;
        $style = $automation->generationOption('image_style', 'modern editorial photography or a clean, detailed illustration with natural lighting and a cohesive color palette');

        $parts = [
            "Create a {$role['label']} image for a {$entity} titled \"{$title}\".",
        ];
        if ($summary !== '') {
            $parts[] = 'What it is about: ' . Str::limit($summary, 400);
        }
        if ($category) {
            $parts[] = "Category: {$category}.";
        }
        $parts[] = "Style: {$style}.";
        $parts[] = 'The image must clearly depict the subject. Do not include any text, letters, captions, logos or watermarks.';
        return implode(' ', $parts);
    }
}
