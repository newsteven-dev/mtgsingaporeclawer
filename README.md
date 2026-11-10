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

Requires Node.js 20.12 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. Add `?card=Lightning%20Bolt` to the URL to link straight to a card.

## Price history (Supabase)

Every fresh price check is saved to Supabase, so the app can chart how each store's cheapest
in-stock price for a card changes over time and list recently tracked cards on the home page.

1. Copy `.env.example` to `.env`.
2. In the Supabase dashboard for the `mtgsingaporeclawer` project, open **Project Settings → API Keys**,
   create or copy a **secret key** (`sb_secret_...`) and paste it as `SUPABASE_SECRET_KEY`.
3. Restart the app. The console prints `Price history: saving to Supabase`.

The secret key stays on the server and is never sent to the browser. Without it the app still
works; price history is just turned off.

The database schema is in `supabase/migrations/` and is already applied to the project:

- `price_snapshots`: one row per card and store check, with the cheapest in-stock price overall, non-foil and foil.
- `price_listings`: the in-stock listings captured with each snapshot.
- `card_price_daily` (view): the cheapest price per card, store and day (Singapore time).
- `trending_cards` (view): cards checked in the last 30 days, with the cheapest price now and 7 days ago.

All tables have Row Level Security turned on with no public policies, so only the server's secret key can read or write them.
Results are cached for 10 minutes, so a card searched repeatedly is saved at most once per store every 10 minutes.

## Put it on the internet (Render)

The repo includes a `render.yaml`, so [Render](https://render.com) can set everything up from it.

1. Sign up at https://render.com with your GitHub account.
2. Click **New → Blueprint**, choose the `mtgsingaporeclawer` repository and click **Connect**.
3. Render reads `render.yaml` and asks for `SUPABASE_SECRET_KEY`. Paste your `sb_secret_...` key and click **Apply**.
4. After a few minutes the app is live at an address like `https://mtg-sg-price-compare.onrender.com`.
   Render redeploys automatically every time `main` changes.

Notes:

- The free plan sleeps after about 15 minutes without visitors, so the first visit after that takes 30–60 seconds to load.
  Upgrade the service to a paid instance in Render to keep it always on.
- The service runs in Render's Singapore region, close to the shops.
- Each visitor is limited to about 40 card searches per 10 minutes (`SEARCHES_PER_10_MIN`) so the public site can't be used to flood the shops.

Any host that runs Node.js works the same way: build with `npm ci`, start with `npm start`, and set the
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` environment variables.

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
| `GET /api/prices?store=agora&name=Lightning%20Bolt[&refresh=1]` | Listings at one store (fresh results are saved to Supabase) |
| `GET /api/history?name=Lightning%20Bolt&days=90` | Daily cheapest price per store |
| `GET /api/trending` | Recently tracked cards with price change vs 7 days ago |

Store ids: `agora`, `mtgasia`, `moxandlotus`, `tcgmarketplace`, `greyogre`.

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `SUPABASE_URL` | none | Supabase project URL (turns on price history) |
| `SUPABASE_SECRET_KEY` | none | Supabase secret or service_role key, server only |
| `CACHE_MINUTES` | `10` | How long price results are cached |
| `SEARCHES_PER_10_MIN` | `40` | Card searches allowed per visitor every 10 minutes |
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
