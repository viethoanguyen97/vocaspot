# VocaSpot - CEFR Vocabulary Highlighter

Spot the right words. Read with confidence.

VocaSpot is a Chrome extension for English learners that highlights words on news pages based on CEFR difficulty level. Select your target level, browse any article, and click highlighted words to see definitions in context. It works entirely with free resources and requires no account.

## Features

- CEFR level word highlighting (A1-C2)
- Context-aware tooltip with definition
- Full definition sidebar
- Works on BBC, Guardian, CNN, Reuters and more
- 100% free, no account required, no data collected

## How It Works

1. Select your target CEFR level in the popup
2. Browse any news article
3. Click highlighted words to see definitions in context

## Installation

### From Chrome Web Store

[VocaSpot - CEFR Vocabulary Highlighter](https://chromewebstore.google.com/detail/ogpfelooklhlokeplobiofkhnhgpldoh?utm_source=item-share-cb)

### Manual Installation (Developer Mode)

1. Clone this repo
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Click Load unpacked and select the cloned folder
5. Navigate to any news article

## Tech Stack

- Vanilla JavaScript (no frameworks)
- Manifest V3
- Free Dictionary API (dictionaryapi.dev)
- compromise.js for lemmatization
- CEFR-J wordlist data (bundled, offline)

## Privacy

No account is required and no personal data is collected. The only external request made is a word lookup to `dictionaryapi.dev` when you click a highlighted word. No browsing history, no page content, and no user data is sent anywhere. Full source code is available for review.

## Contributing

Contributions are welcome. Open a GitHub Issue to report bugs or suggest improvements. The easiest way to contribute is via `custom_overrides.json` — this file lets you add missing news vocabulary words with their CEFR levels without touching any code.

## References & Attribution

**CEFR Wordlist**
CEFR-J Wordlist by the [CEFR-J Project](http://www.cefr-j.org/) (Tono Laboratory, Tokyo University of Foreign Studies) and [Octanove Labs](https://github.com/octanove), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

**Dictionary API**
Word definitions are powered by the [Free Dictionary API](https://dictionaryapi.dev/) — a free, open-source REST API providing definitions, phonetics, and more.

**NLP**
Lemmatization powered by [compromise](https://github.com/spencermountain/compromise) by Spencer Kelly.

## License

This project is licensed under the
GNU General Public License v3.0.

You are free to use, study, and modify this code.
Any distribution of this software or derivative
works must also be released under GPL v3.

See [LICENSE](LICENSE) for full terms.

## Built With AI Assistance

VocaSpot was developed using Claude Code (Anthropic)
as an AI coding assistant under human direction.

All product decisions, architecture, UX choices,
data source selection, and creative direction
by Viet Hoa Nguyen.
