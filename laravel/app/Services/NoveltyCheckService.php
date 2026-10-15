<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\ContentVersion;
use Illuminate\Support\Facades\Log;

class NoveltyCheckService
{
    public function __construct(
        protected AiServiceClient $aiClient,
        protected ContextPackageService $contextPackageService
    ) {}

    /**
     * Check novelty using user and automation id.
     */
    public function checkNovelty(\App\Models\User $user, string $candidateTitle, int $automationId, float $threshold = 0.92): array
    {
        $automation = Automation::where('id', $automationId)
            ->where('user_id', $user->id)
            ->first();

        if (!$automation) {
            return [
                'is_duplicate' => false,
                'highest_similarity' => 0.0,
                'matched_title' => null,
                'angle_suggestion' => null,
            ];
        }

        return $this->check($candidateTitle, $automation, $threshold);
    }

    /**
     * Check if a candidate title is too similar to recently published/generated titles
     * for the given automation.
     *
     * @param string $candidateTitle
     * @param Automation $automation
     * @param float $threshold Default 0.92
     * @return array{
     *   is_duplicate: bool,
     *   highest_similarity: float,
     *   matched_title: ?string,
     *   angle_suggestion: ?string
     * }
     */
    public function check(string $candidateTitle, Automation $automation, float $threshold = 0.92): array
    {
        $candidate = trim($candidateTitle);
        if (empty($candidate)) {
            return [
                'is_duplicate' => false,
                'highest_similarity' => 0.0,
                'matched_title' => null,
                'angle_suggestion' => null,
            ];
        }

        $recentTitles = $this->contextPackageService->loadRecentTitles($automation, 50);
        if (empty($recentTitles)) {
            return [
                'is_duplicate' => false,
                'highest_similarity' => 0.0,
                'matched_title' => null,
                'angle_suggestion' => null,
            ];
        }

        // 1. Try Python AI service semantic cosine similarity
        try {
            $result = $this->aiClient->checkNovelty($candidate, $recentTitles, $threshold);
            return [
                'is_duplicate' => (bool) ($result['is_duplicate'] ?? false),
                'highest_similarity' => (float) ($result['highest_similarity'] ?? 0.0),
                'matched_title' => $result['matched_title'] ?? null,
                'angle_suggestion' => $result['angle_suggestion'] ?? null,
            ];
        } catch (\Throwable $e) {
            Log::warning("[NoveltyCheckService] AI service checkNovelty unavailable, using fallback: " . $e->getMessage());
            return $this->fallbackCheck($candidate, $recentTitles, $threshold);
        }
    }

    /**
     * Pure PHP fallback calculating normalized Levenshtein and Token Jaccard overlap.
     */
    public function fallbackCheck(string $candidate, array $recentTitles, float $threshold = 0.92): array
    {
        $cleanCandidate = strtolower(trim($candidate));
        $candidateTokens = array_filter(preg_split('/\W+/', $cleanCandidate));
        $candidateTokenSet = array_flip($candidateTokens);

        $highestSim = 0.0;
        $matchedTitle = null;

        foreach ($recentTitles as $rTitle) {
            $cleanRecent = strtolower(trim($rTitle));
            if (empty($cleanRecent)) continue;

            // Exact match
            if ($cleanCandidate === $cleanRecent) {
                return [
                    'is_duplicate' => true,
                    'highest_similarity' => 1.0,
                    'matched_title' => $rTitle,
                    'angle_suggestion' => 'Refocus on practical case studies or technical deep dive rather than repeating this title.',
                ];
            }

            // Levenshtein similarity
            $maxLen = max(strlen($cleanCandidate), strlen($cleanRecent));
            $levSim = $maxLen > 0 ? 1.0 - (levenshtein($cleanCandidate, $cleanRecent) / $maxLen) : 0.0;

            // Token Jaccard similarity
            $recentTokens = array_filter(preg_split('/\W+/', $cleanRecent));
            $recentTokenSet = array_flip($recentTokens);

            $intersection = count(array_intersect_key($candidateTokenSet, $recentTokenSet));
            $union = count(array_replace($candidateTokenSet, $recentTokenSet));
            $jaccardSim = $union > 0 ? $intersection / $union : 0.0;

            $combinedSim = max($levSim, $jaccardSim);
            if ($combinedSim > $highestSim) {
                $highestSim = $combinedSim;
                $matchedTitle = $rTitle;
            }
        }

        $isDuplicate = $highestSim >= $threshold;
        return [
            'is_duplicate' => $isDuplicate,
            'highest_similarity' => round($highestSim, 4),
            'matched_title' => $isDuplicate ? $matchedTitle : null,
            'angle_suggestion' => $isDuplicate ? 'Explore a specialized sub-topic, case study, or contrarian angle.' : null,
        ];
    }
}
