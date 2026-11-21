# Ogmios brand

Ogmios, the Gaulish god of eloquence, led his listeners by fine chains of gold and amber that ran from his tongue to their ears. The symbol is where that chain arrives: a single squared line that winds inwards like an ear and is never cut, the way you talk in Ogmios without being stopped. At its centre sits one amber square, the one focus you take away from a conversation.

The full guide, with every version on its ground, is [`brand-book.html`](brand-book.html). Open it in a browser.

## Files

| Folder                                        | What it holds                                                                                                                                                                                    | Use it for                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `logo/ogmios-symbol.svg`                      | Master, one ink (`currentColor`); the square is marked `data-ink="accent"`                                                                                                                       | Code that sets the colour itself                              |
| `logo/ogmios-symbol-small.svg`                | Small-size cut: one and a half turns, thicker line, no square                                                                                                                                    | Anything under 32 px                                          |
| `logo/ogmios-symbol-color.svg`                | Ink line, bronze square                                                                                                                                                                          | Light grounds                                                 |
| `logo/ogmios-symbol-on-dark.svg`              | Paper line, amber square                                                                                                                                                                         | Dark grounds (the default home of the brand)                  |
| `logo/ogmios-symbol-black.svg` / `-white.svg` | One ink                                                                                                                                                                                          | One-colour print, engraving, overlays                         |
| `logo/ogmios-horizontal*.svg`                 | Symbol + name, side by side                                                                                                                                                                      | Headers, the README, the website                              |
| `logo/ogmios-stacked*.svg`                    | Symbol over the name                                                                                                                                                                             | Square spaces, splash screens                                 |
| `logo/ogmios-wordmark.svg`                    | The name alone, outlined                                                                                                                                                                         | Where the symbol is already present                           |
| `logo/png/`                                   | Symbol at 64-1024 px and horizontal at 800 and 1600 px, light and dark, transparent                                                                                                              | Places that do not take SVG                                   |
| `web/`                                        | `favicon.svg`, `favicon.ico` (16, 32, 48), `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `maskable-512.png`, `og-image.png`, `site.webmanifest`, `head-snippet.html` | The website and the app icon                                  |
| `social/`                                     | `github-social-preview.png` (1280×640), `github-avatar.png` (500×500)                                                                                                                            | Repository settings → Social preview; the organisation avatar |
| `motion/ogmios-animated.svg`                  | The line draws itself in, then the square lands (1.4 s, CSS only, respects reduced motion)                                                                                                       | Splash, loading, the website hero. Drawn for dark grounds     |
| `tokens.json`                                 | Colours, fonts and the unit                                                                                                                                                                      | Code                                                          |

The name in every lockup is outlined: no font is needed to show it.

## Colour

| Colour   | HEX       | RGB         | Use                                                          |
| -------- | --------- | ----------- | ------------------------------------------------------------ |
| Amber    | `#F2B544` | 242 181 68  | The square, highlights, surfaces. On dark only, or as a tile |
| Bronze   | `#9A6200` | 154 98 0    | Amber's role on light grounds: the square, small text, lines |
| Graphite | `#141518` | 20 21 24    | The brand's ground, the line, text                           |
| Paper    | `#F3F2EE` | 243 242 238 | Light grounds, the line on dark                              |

Contrast: amber on graphite 10.0:1 · paper on graphite 16.3:1 · graphite on amber 10.0:1 · bronze on paper 4.6:1 · amber on paper 1.6:1, so amber never sits on a light ground as a line, a square or text.

Red is not a brand colour: in the app it marks a wrong answer and destructive actions. Amber already plays a close role there: the app's `partial` verdict is an orange amber that means "something to work on", the same job as the focus square.

## Type

- **Space Grotesk 700**, lowercase, tracking -0.04 em: the name and headings.
- **Plus Jakarta Sans**: text and interface (the app already uses it).
- **JetBrains Mono**: code and numbers that must align.

All three are free under the SIL Open Font License.

## Rules

- **Unit:** u = the width of the line (26 on the 256 grid).
- **Clear space:** 2u on every side of the symbol or the lockup.
- **Minimum size:** the full symbol from 32 px; the small cut below that, down to 16 px. Horizontal lockup from 120 px wide.
- **Don't:** stretch or rotate the mark, close the spiral's open start, move the square, put amber on a light ground, set the name in another font, or add a gradient or shadow.

## Before public use

Run a trademark search. Square spirals are an old ornament and appear in other marks.

Identity made with [kothar](https://github.com/ilien-dev/kothar).
