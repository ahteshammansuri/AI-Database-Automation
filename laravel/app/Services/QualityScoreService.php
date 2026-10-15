<?php

namespace App\Services;

class QualityScoreService
{
    /**
     * Compute quality scores across Readability, SEO suitability, and Factual grounding.
     *
     * @param array $payload The generated content payload (title, content, slug, excerpt, etc.)
     * @param array $ragContextPassages Optional RAG passages to evaluate factual grounding against
     * @return array Structured quality score breakdown with overall score from 0 to 100
     */
    public function evaluateContent(array $payload, array $ragContextPassages = []): array
    {
        $title = trim($payload['title'] ?? '');
        $content = trim($payload['content'] ?? '');
        $slug = trim($payload['slug'] ?? '');
        $excerpt = trim($payload['excerpt'] ?? '');

        $readability = $this->calculateReadability($content);
        $seo = $this->calculateSeoMetrics($title, $slug, $excerpt, $content);
        $factual = $this->calculateFactualGrounding($content, $ragContextPassages);

        // Weighted Overall Score: 35% SEO, 35% Readability, 30% Factual Grounding
        $overallScore = round(
            ($seo['score'] * 0.35) +
            ($readability['score'] * 0.35) +
            ($factual['score'] * 0.30)
        );

        $grade = $overallScore >= 90 ? 'A+' :
            ($overallScore >= 80 ? 'A' :
            ($overallScore >= 70 ? 'B' :
            ($overallScore >= 60 ? 'C' : 'Needs Review')));

        $suggestions = array_merge(
            $seo['suggestions'],
            $readability['suggestions'],
            $factual['suggestions']
        );

        return [
            'overall_score' => $overallScore,
            'grade' => $grade,
            'readability' => $readability,
            'seo' => $seo,
            'factual_grounding' => $factual,
            'suggestions' => $suggestions,
        ];
    }

    /**
     * Calculate Flesch-Kincaid Reading Ease and Grade Level.
     */
    protected function calculateReadability(string $text): array
    {
        if (empty($text)) {
            return [
                'score' => 50,
                'flesch_reading_ease' => 50,
                'grade_level' => 'N/A',
                'word_count' => 0,
                'sentence_count' => 0,
                'suggestions' => ['Add content body to calculate readability.'],
            ];
        }

        // Strip HTML / Markdown tags for accurate text statistics
        $cleanText = strip_tags($text);
        $cleanText = preg_replace('/[#*_`~\[\]\(\)]/', '', $cleanText);

        $words = preg_split('/\s+/', trim($cleanText));
        $wordCount = max(1, count(array_filter($words)));

        // Sentences based on terminal punctuation
        $sentences = preg_split('/[.?!]+(\s+|$)/', trim($cleanText));
        $sentenceCount = max(1, count(array_filter($sentences)));

        // Syllable approximation
        $syllableCount = 0;
        foreach ($words as $w) {
            $syllableCount += $this->countSyllables($w);
        }

        $wordsPerSentence = $wordCount / $sentenceCount;
        $syllablesPerWord = $syllableCount / $wordCount;

        // Flesch Reading Ease: 206.835 - 1.015 * (words/sentence) - 84.6 * (syllables/word)
        $fleschEase = round(206.835 - (1.015 * $wordsPerSentence) - (84.6 * $syllablesPerWord));
        $fleschEase = max(0, min(100, $fleschEase));

        // Approximate Grade Level
        $gradeLevel = $fleschEase >= 90 ? '5th Grade (Very Easy)' :
            ($fleschEase >= 80 ? '6th Grade (Easy)' :
            ($fleschEase >= 70 ? '7th Grade (Fairly Easy)' :
            ($fleschEase >= 60 ? '8th-9th Grade (Standard)' :
            ($fleschEase >= 50 ? '10th-12th Grade (Fairly Difficult)' :
            ($fleschEase >= 30 ? 'College (Difficult)' : 'Graduate (Very Confusing)')))));

        // Normalize readability score to 0-100 (60-80 ease is ideal for web blogs)
        $score = $fleschEase >= 50 && $fleschEase <= 80 ? 95 :
            ($fleschEase > 80 ? 88 : max(40, $fleschEase));

        $suggestions = [];
        if ($wordsPerSentence > 25) {
            $suggestions[] = 'Break up long sentences into shorter, punchy thoughts to improve readability.';
        }
        if ($wordCount < 150) {
            $suggestions[] = 'Content length is under 150 words. Expanding depth improves user engagement.';
        }

        return [
            'score' => $score,
            'flesch_reading_ease' => $fleschEase,
            'grade_level' => $gradeLevel,
            'word_count' => $wordCount,
            'sentence_count' => $sentenceCount,
            'suggestions' => $suggestions,
        ];
    }

    /**
     * Approximate syllable count in a single word.
     */
    protected function countSyllables(string $word): int
    {
        $word = strtolower(trim($word));
        $word = preg_replace('/[^a-z]/', '', $word);
        if (strlen($word) <= 3) {
            return 1;
        }

        $word = preg_replace('/(?:[^laeiouy]|ed|es|e)$/', '', $word);
        $word = preg_replace('/^y/', '', $word);
        preg_match_all('/[aeiouy]{1,2}/', $word, $matches);
        return max(1, count($matches[0] ?? []));
    }

    /**
     * Evaluate SEO factors: title length, slug kebab formatting, excerpt conciseness, heading structure.
     */
    protected function calculateSeoMetrics(string $title, string $slug, string $excerpt, string $content): array
    {
        $score = 100;
        $suggestions = [];

        // Title evaluation (optimal: 30 - 70 chars)
        $titleLen = mb_strlen($title);
        if ($titleLen === 0) {
            $score -= 30;
            $suggestions[] = 'Missing article title.';
        } elseif ($titleLen < 25) {
            $score -= 10;
            $suggestions[] = 'Title is slightly short. Aim for 30–65 characters for optimal search snippets.';
        } elseif ($titleLen > 70) {
            $score -= 10;
            $suggestions[] = 'Title exceeds 70 characters and may be truncated on search result pages.';
        }

        // Slug evaluation
        if (empty($slug)) {
            $score -= 15;
            $suggestions[] = 'Missing URL slug.';
        } elseif (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) {
            $score -= 15;
            $suggestions[] = 'Slug must follow kebab-case format (lowercase letters, numbers, and single hyphens).';
        }

        // Excerpt evaluation (optimal: 80 - 180 chars)
        $excerptLen = mb_strlen($excerpt);
        if ($excerptLen > 0 && ($excerptLen < 50 || $excerptLen > 220)) {
            $score -= 10;
            $suggestions[] = 'Meta excerpt length is ideally 120–160 characters for search previews.';
        }

        // Markdown headings presence in body
        if (!empty($content)) {
            $hasHeadings = preg_match('/^#{2,4}\s+/m', $content) || preg_match('/<h[2-4]>/i', $content);
            if (!$hasHeadings && mb_strlen($content) > 300) {
                $score -= 15;
                $suggestions[] = 'Structure content with H2/H3 subheadings to improve search discoverability and scannability.';
            }
        }

        return [
            'score' => max(0, $score),
            'title_length' => $titleLen,
            'slug_valid' => empty($slug) ? false : (bool) preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug),
            'excerpt_length' => $excerptLen,
            'suggestions' => $suggestions,
        ];
    }

    /**
     * Compute factual grounding overlap against supplied RAG knowledge passages.
     */
    protected function calculateFactualGrounding(string $content, array $passages): array
    {
        if (empty($passages)) {
            return [
                'score' => 85,
                'grounded_percentage' => 85,
                'passage_count' => 0,
                'suggestions' => [],
            ];
        }

        $contentWords = array_unique(array_filter(preg_split('/\s+/', strtolower(strip_tags($content)))));
        $stopWords = ['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'were', 'which', 'your'];
        $contentKeywords = array_diff($contentWords, $stopWords);

        if (empty($contentKeywords)) {
            return [
                'score' => 80,
                'grounded_percentage' => 80,
                'passage_count' => count($passages),
                'suggestions' => [],
            ];
        }

        $allPassageText = strtolower(implode(' ', array_map(function ($p) {
            return is_array($p) ? ($p['text'] ?? ($p['content'] ?? '')) : (string) $p;
        }, $passages)));

        $matchedCount = 0;
        foreach ($contentKeywords as $kw) {
            if (strlen($kw) > 3 && str_contains($allPassageText, $kw)) {
                $matchedCount++;
            }
        }

        $ratio = count($contentKeywords) > 0 ? ($matchedCount / count($contentKeywords)) : 1.0;
        $groundedScore = round(min(100, max(50, $ratio * 120)));

        $suggestions = [];
        if ($groundedScore < 65) {
            $suggestions[] = 'Generated content has low direct keyword overlap with uploaded knowledge passages.';
        }

        return [
            'score' => $groundedScore,
            'grounded_percentage' => $groundedScore,
            'passage_count' => count($passages),
            'suggestions' => $suggestions,
        ];
    }
}
