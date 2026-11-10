# MTG SG Price Compare

Type a Magic: The Gathering card name and compare its singles prices across five Singapore stores:

| Store | How prices are read |
| --- | --- |
| [Agora Hobby](https://agorahobby.com/) | Server-rendered store search page (`/store/search?category=mtg`) |
| [MTG Asia](https://mtg-asia.com/) | The same public inventory query the storefront's search box makes |
| [Mox & Lotus](https://moxandlotus.sg/) | The storefront's JSON product search (`/api/products?search=`) |
| [The TCG Marketplace](https://thetcgmarketplace.com/) | The storefront's product filter API (`:3501/product/filter`), lowest seller price |
| [Grey Ogre Games](https://www.greyogregames.com/) | Shopify search results (`title:"<card>"`), per-condition variants |

Card-name autocomplete and card details (image, type line, USD reference price) come from the
[Scryfall API](https://scryfall.com/docs/api). Every card also links to its
[Gatherer](https://gatherer.wizards.com/) page. (Gatherer has no public API, so Scryfall supplies the suggestions.)

## Run it

Requires Node.js 18 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. Add `?card=Lightning%20Bolt` to the URL to link straight to a card.

## How it works

- `public/` is the web page. While you type, it asks `/api/autocomplete` for suggestions (debounced; ↑/↓, Tab and Enter work).
- When you pick a card, the page sends one `/api/prices?store=<id>&name=<card>` request per store in parallel, so each store's tile fills in as soon as that store answers.
- `src/stores/*.js` holds one adapter per shop. Each returns listings shaped like
  `{ title, set, setCode, condition, finish, price, stock, inStock, url, image }`.
  Titles are matched exactly against the Scryfall card name (so `Lightning Bolt` doesn't pull in `Chain Lightning`).
- Results are cached in memory for 10 minutes (`CACHE_MINUTES`). The **Refresh prices** button skips the cache.

### API

| Endpoint | Description |
| --- | --- |
| `GET /api/stores` | Configured stores |
| `GET /api/autocomplete?q=bolt` | Card-name suggestions (Scryfall) |
| `GET /api/card?name=Lightning%20Bolt` | Card details (Scryfall) |
| `GET /api/prices?store=agora&name=Lightning%20Bolt[&refresh=1]` | Listings at one store |

Store ids: `agora`, `mtgasia`, `moxandlotus`, `tcgmarketplace`, `greyogre`.

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `CACHE_MINUTES` | `10` | How long price results are cached |
| `TCG_API_URL` | `https://thetcgmarketplace.com:3501/` | TCG Marketplace API base |
| `TCG_MTG_CATEGORY_ID` | auto-detected | Skip the category lookup |
| `MTGASIA_APP_ID` | value from the site | MTG Asia storefront app id |

## Tests

```bash
npm test
```

The tests cover the parsers and name matching using small HTML/JSON fixtures, so they need no network access.

## Notes

- Prices are in SGD as each store lists them. Stores change their sites, so an adapter may break and need updating; when that happens its tile shows the error and a link to search the store directly.
- Please use this tool reasonably. It makes a few requests per store per search and caches results to keep load on the shops light.
