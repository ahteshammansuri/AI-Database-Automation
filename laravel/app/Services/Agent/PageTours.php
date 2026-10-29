<?php

namespace App\Services\Agent;

use App\Models\AgentTask;
use App\Models\OrbitPageTour;

/**
 * The browser payload for Orbit's guided tours, built from the page explanations stored in the database.
 * Every step is checked against the portal catalog: unknown surfaces, fields or buttons are dropped, and a button
 * marked consequential is never pressed (a tour only opens and closes things, it never changes data).
 */
final class PageTours
{
    /** Longest sentence the browser speaks for one step. */
    private const MAX_SAY = 400;

    /** Pages of the portal tour, in order: route, title and the overview to speak there. */
    public static function tourPages(): array
    {
        $routes = SurfaceCatalog::routes();

        $tours = OrbitPageTour::where('is_active', true)->orderBy('sort')->orderBy('id')->get()
            ->filter(fn (OrbitPageTour $t) => in_array($t->route, $routes, true))
            ->map(fn (OrbitPageTour $t) => ['route' => $t->route, 'title' => $t->title, 'say' => self::clip($t->overview)])
            ->values()->all();

        if (!empty($tours)) {
            return $tours;
        }

        $body = \App\Models\OrbitKnowledgeGuide::where('slug', 'portal_tour')->value('body');
        if (!$body) {
            return [];
        }

        $pages = [];
        if (preg_match_all('/##\s+([^\n#]+?)\s+\(`?(\/[a-zA-Z0-9_\-\/]+)`?\)\s*\n\n(.*?)(?=\n##|\z)/s', $body, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $m) {
                $r = trim($m[2]);
                if (in_array($r, $routes, true)) {
                    $pages[] = [
                        'route' => $r,
                        'title' => trim($m[1]),
                        'say' => self::clip(trim($m[3])),
                    ];
                }
            }
        }

        return $pages;
    }

    /** One page: its overview, and for "detailed" the checked steps. Null when the page has no explanation. */
    public static function page(string $route, string $depth): ?array
    {
        $tour = OrbitPageTour::where('route', $route)->first();
        if ($tour && !$tour->is_active) {
            return null;
        }
        if ($tour) {
            return [
                'route' => $tour->route,
                'title' => $tour->title,
                'overview' => self::clip($tour->overview),
                'depth' => $depth === 'detailed' ? 'detailed' : 'overview',
                'steps' => $depth === 'detailed' ? self::validSteps((array) $tour->steps) : [],
            ];
        }

        $knowledge = self::knowledgeOverview($route);
        if (!$knowledge) {
            return null;
        }

        return [
            'route' => $route,
            'title' => $knowledge['title'],
            'overview' => $knowledge['overview'],
            'depth' => 'overview',
            'steps' => [],
        ];
    }

    /** Extract title and overview from the published portal_tour knowledge guide for a route. */
    public static function knowledgeOverview(string $route): ?array
    {
        $body = \App\Models\OrbitKnowledgeGuide::where('slug', 'portal_tour')->value('body');
        if (!$body) {
            return null;
        }
        $escaped = preg_quote($route, '/');
        if (preg_match('/##\s+([^\n#]+?)\s+\(`?' . $escaped . '`?\)\s*\n\n(.*?)(?=\n##|\z)/s', $body, $m)) {
            return [
                'title' => trim($m[1]),
                'overview' => self::clip(trim($m[2])),
            ];
        }
        return null;
    }

    /** The route explain_page is about: the one asked for, else the page the user is on. */
    public static function routeFor(array $args, AgentTask $task): ?string
    {
        $routes = SurfaceCatalog::routes();
        $asked = (string) ($args['page'] ?? '');
        if ($asked !== '') {
            return in_array($asked, $routes, true) ? $asked : null;
        }
        $current = (string) (($task->page_context ?? [])['currentPath'] ?? '');

        return in_array($current, $routes, true) ? $current : null;
    }

    /**
     * Steps that are safe and resolvable: known kinds, catalogued surfaces / fields / actions, presses only of
     * non-consequential actions, short spoken text.
     */
    public static function validSteps(array $steps): array
    {
        $out = [];
        foreach (array_slice($steps, 0, 40) as $step) {
            if (!is_array($step) || !in_array($step['do'] ?? null, OrbitPageTour::STEP_KINDS, true)) {
                continue;
            }
            $say = self::clip((string) ($step['say'] ?? ''));
            $kind = $step['do'];
            if (in_array($kind, ['say', 'close_popup'], true)) {
                if ($say !== '' || $kind === 'close_popup') {
                    $out[] = ['do' => $kind, 'say' => $say];
                }
                continue;
            }
            $surface = SurfaceCatalog::surface((string) ($step['surface'] ?? ''));
            if (!$surface) {
                continue;
            }
            $clean = ['do' => $kind, 'surface' => $surface['id'], 'say' => $say];
            if (!empty($step['field'])) {
                if (!SurfaceCatalog::field($surface, (string) $step['field'])) {
                    continue;
                }
                $clean['field'] = (string) $step['field'];
            }
            if (!empty($step['action'])) {
                $action = SurfaceCatalog::action($surface, (string) $step['action']);
                if (!$action || ($kind === 'press' && (!empty($action['consequential']) || !empty($action['destructive'])))) {
                    continue;
                }
                $clean['action'] = $action['id'];
                if (!empty($action['row'])) {
                    $clean['row'] = 'first';
                }
            }
            if ($kind === 'press' && empty($clean['action'])) {
                continue;
            }
            $out[] = $clean;
        }

        return $out;
    }

    /**
     * Why steps of a page's explanation would not run, one message per step (for the admin form). Uses the same
     * checks as validSteps(), plus: a step's surface must be on that page.
     */
    public static function problems(string $route, array $steps): array
    {
        $out = [];
        foreach (array_values($steps) as $i => $step) {
            $n = $i + 1;
            if ($i >= 40) {
                $out[] = 'Only the first 40 steps are used.';
                break;
            }
            $surface = is_array($step) && !empty($step['surface']) ? SurfaceCatalog::surface((string) $step['surface']) : null;
            if ($surface && $surface['route'] !== $route) {
                $out[] = "Step {$n}: \"{$surface['title']}\" is on {$surface['route']}, not on this page.";
            } elseif (self::validSteps([$step]) === []) {
                $out[] = match (true) {
                    !is_array($step) || !in_array($step['do'] ?? null, OrbitPageTour::STEP_KINDS, true) => "Step {$n}: choose what Orbit does.",
                    ($step['do'] ?? '') === 'say' => "Step {$n}: write what Orbit says.",
                    ($step['do'] ?? '') === 'press' && empty($step['action']) => "Step {$n}: choose the button to press.",
                    ($step['do'] ?? '') === 'press' => "Step {$n}: that button changes data, so a tour may only point at it.",
                    default => "Step {$n}: the part, field or button is not in the portal catalog.",
                };
            }
        }

        return $out;
    }

    private static function clip(string $text): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text) ?? '');

        return mb_strlen($text) > self::MAX_SAY ? mb_substr($text, 0, self::MAX_SAY - 1) . '…' : $text;
    }
}
